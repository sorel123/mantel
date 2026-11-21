import EventKit
import Foundation
import MantelSyncCore

/// Apple Reminders through EventKit. Shared family lists appear like any other list.
final class EventKitStore: ReminderStore {
    let store = EKEventStore()

    /// Ask for full access to Reminders (macOS 14 and later ask for "full access" by name).
    func requestAccess() async -> Bool {
        if #available(macOS 14.0, *) {
            return (try? await store.requestFullAccessToReminders()) ?? false
        }
        return await withCheckedContinuation { done in
            store.requestAccess(to: .reminder) { granted, _ in done.resume(returning: granted) }
        }
    }

    var hasAccess: Bool {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        if #available(macOS 14.0, *) { return status == .fullAccess }
        return status == .authorized
    }

    func lists() throws -> [RemoteList] {
        store.calendars(for: .reminder).map { cal in
            RemoteList(
                id: cal.calendarIdentifier, name: cal.title,
                detail: cal.source.map { $0.title })
        }
    }

    func items(in listId: String) throws -> [RemoteItem] {
        guard let cal = store.calendar(withIdentifier: listId) else { return [] }
        // Open reminders, and ones completed in the last two days (so a tick on the phone counts).
        let open = store.predicateForIncompleteReminders(
            withDueDateStarting: nil, ending: nil, calendars: [cal])
        let recent = store.predicateForCompletedReminders(
            withCompletionDateStarting: Date().addingTimeInterval(-2 * 86_400), ending: nil,
            calendars: [cal])
        let iso = ISO8601DateFormatter()
        return (fetch(open) + fetch(recent)).map { r in
            RemoteItem(
                id: r.calendarItemIdentifier, text: r.title ?? "", done: r.isCompleted,
                updatedAt: r.lastModifiedDate.map { iso.string(from: $0) })
        }
    }

    func add(to listId: String, text: String, done: Bool) throws -> String {
        guard let cal = store.calendar(withIdentifier: listId) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let r = EKReminder(eventStore: store)
        r.calendar = cal
        r.title = text
        r.isCompleted = done
        try store.save(r, commit: true)
        return r.calendarItemIdentifier
    }

    func update(id: String, text: String?, done: Bool?) throws {
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return }
        if let text { r.title = text }
        if let done { r.isCompleted = done }
        try store.save(r, commit: true)
    }

    func delete(id: String) throws {
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return }
        try store.remove(r, commit: true)
    }

    /// EventKit fetches are asynchronous; the sync loop runs off the main thread, so wait here.
    private func fetch(_ predicate: NSPredicate) -> [EKReminder] {
        let done = DispatchSemaphore(value: 0)
        var found: [EKReminder] = []
        store.fetchReminders(matching: predicate) { reminders in
            found = reminders ?? []
            done.signal()
        }
        done.wait()
        return found
    }
}
