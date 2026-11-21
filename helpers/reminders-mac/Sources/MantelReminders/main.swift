import AppKit
import EventKit
import MantelSyncCore
import ServiceManagement

let helperVersion = "1.0.0"

/// The menu-bar app: a checklist icon, the sync status, Sync now, Pair, Launch at login, Quit.
/// Syncs every few seconds while the Mac is awake, and straight away when Reminders changes
/// (an item added by Siri on a phone arrives through iCloud and fires that).
/// A flag the sync loop checks while it waits, so a change in Reminders syncs at once.
final class Nudge: @unchecked Sendable {
    private let lock = NSLock()
    private var set = false
    func poke() { lock.lock(); set = true; lock.unlock() }
    func take() -> Bool { lock.lock(); defer { set = false; lock.unlock() }; return set }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let reminders = EventKitStore()
    private var item: NSStatusItem!
    private let statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    private let serverLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let loginItem = NSMenuItem(
        title: "Open at login", action: #selector(toggleLogin), keyEquivalent: "")
    private var engine: SyncEngine?
    private var loop: Task<Void, Never>?
    private let nudge = Nudge()

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(
            systemSymbolName: "checklist", accessibilityDescription: "Mantel Reminders")
        let menu = NSMenu()
        menu.delegate = self
        statusLine.isEnabled = false
        serverLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(serverLine)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Sync now", action: #selector(syncNow), keyEquivalent: "s"))
        menu.addItem(
            NSMenuItem(title: "Pair with Mantel…", action: #selector(pair), keyEquivalent: "p"))
        menu.addItem(
            NSMenuItem(title: "Open Mantel settings", action: #selector(openSettings), keyEquivalent: ""))
        menu.addItem(loginItem)
        menu.addItem(.separator())
        menu.addItem(
            NSMenuItem(title: "Quit Mantel Reminders", action: #selector(quit), keyEquivalent: "q"))
        for m in menu.items where m.action != nil { m.target = self }
        item.menu = menu

        NotificationCenter.default.addObserver(
            self, selector: #selector(storeChanged), name: .EKEventStoreChanged,
            object: reminders.store)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(syncNow), name: NSWorkspace.didWakeNotification, object: nil)

        Task { @MainActor in
            if !reminders.hasAccess, !(await reminders.requestAccess()) {
                show("Allow Reminders in System Settings › Privacy › Reminders")
                return
            }
            if server() == nil { pair() } else { start() }
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        refresh()
    }

    // MARK: - sync loop

    private func server() -> MantelServer? {
        guard let s = UserDefaults.standard.string(forKey: "server"), let url = URL(string: s),
            let key = Keychain.read("deviceKey")
        else { return nil }
        return MantelServer(base: url, deviceKey: key)
    }

    private func start() {
        guard let server = server() else { return }
        loop?.cancel()
        let engine = SyncEngine(
            store: reminders, transport: server,
            helper: HelperInfo(name: Host.current().localizedName ?? "Mac", version: helperVersion))
        self.engine = engine
        let nudge = self.nudge
        loop = Task.detached { [weak self] in
            while !Task.isCancelled {
                var wait = 30
                do { wait = try await engine.round() } catch {}
                await self?.refresh()
                // Wait for the server's next time, or until Reminders changes.
                for _ in 0..<(wait * 4) {
                    if Task.isCancelled || nudge.take() { break }
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
            }
        }
    }

    private func refresh() {
        serverLine.title = server().map { "Mantel at \($0.base.host ?? "")" } ?? "Not paired"
        guard let engine else { return show("Not paired yet") }
        if let error = engine.lastError { return show("⚠︎ \(error)") }
        guard let last = engine.lastSync else { return show("Syncing…") }
        let lists = engine.linked.count
        let f = RelativeDateTimeFormatter()
        show(
            "\(lists == 0 ? "No lists shared yet" : "\(lists) list\(lists == 1 ? "" : "s") shared") · synced \(f.localizedString(for: last, relativeTo: Date()))"
        )
    }

    private func show(_ text: String) {
        statusLine.title = text
    }

    @objc nonisolated private func storeChanged() { nudge.poke() }
    @objc private func syncNow() { nudge.poke() }

    // MARK: - menu actions

    @objc private func pair() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Pair with Mantel"
        alert.informativeText =
            "Enter your Mantel address and a pairing code from Settings › Displays › Add a display."
        let address = NSTextField(frame: NSRect(x: 0, y: 30, width: 300, height: 24))
        address.placeholderString = "http://mantel.local:8787"
        address.stringValue = UserDefaults.standard.string(forKey: "server") ?? ""
        let code = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        code.placeholderString = "Six-digit pairing code"
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 56))
        box.addSubview(address)
        box.addSubview(code)
        alert.accessoryView = box
        alert.addButton(withTitle: "Pair")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = address.stringValue.isEmpty ? address : code
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        guard let base = MantelServer.normalise(address.stringValue) else {
            return fail(ServerError.badAddress)
        }
        let name = "\(Host.current().localizedName ?? "Mac") (Reminders)"
        Task { @MainActor in
            do {
                let key = try await MantelServer.pair(
                    base: base, code: code.stringValue, name: name)
                UserDefaults.standard.set(base.absoluteString, forKey: "server")
                Keychain.write("deviceKey", key)
                start()
                let done = NSAlert()
                done.messageText = "Paired"
                done.informativeText =
                    "Now open Mantel’s Settings › Lists and chores and choose “Share this list with…” beside a list."
                done.runModal()
            } catch {
                fail(error)
            }
        }
    }

    private func fail(_ error: Error) {
        let a = NSAlert()
        a.messageText = "Couldn’t pair"
        a.informativeText = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        a.runModal()
    }

    @objc private func openSettings() {
        guard let s = UserDefaults.standard.string(forKey: "server"),
            let url = URL(string: s + "/settings#lists")
        else { return pair() }
        NSWorkspace.shared.open(url)
    }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let a = NSAlert()
            a.messageText = "Couldn’t change Open at login"
            a.informativeText = error.localizedDescription
            a.runModal()
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
