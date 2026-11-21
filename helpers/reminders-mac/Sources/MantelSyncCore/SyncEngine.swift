import Foundation

/// What the engine needs from Reminders. The app implements it with EventKit; tests with a fake.
public protocol ReminderStore: AnyObject {
    func lists() throws -> [RemoteList]
    func items(in listId: String) throws -> [RemoteItem]
    /// Add a reminder; returns its identifier.
    func add(to listId: String, text: String, done: Bool) throws -> String
    func update(id: String, text: String?, done: Bool?) throws
    func delete(id: String) throws
}

/// How the engine reaches the server.
public protocol SyncTransport {
    func sync(_ request: SyncRequest) async throws -> SyncResponse
}

/// One check-in at a time: send the lists, the linked lists' items and the ids of reminders made
/// for the last ops; then carry out the ops the server sends back. The server holds all the sync
/// state, so the engine only remembers which lists are linked and the ids it still has to report.
public final class SyncEngine {
    public private(set) var linked: Set<String> = []
    public private(set) var pendingCreated: [Created] = []
    public private(set) var lastError: String?
    public private(set) var lastSync: Date?

    private let store: ReminderStore
    private let transport: SyncTransport
    private let helper: HelperInfo

    public init(store: ReminderStore, transport: SyncTransport, helper: HelperInfo) {
        self.store = store
        self.transport = transport
        self.helper = helper
    }

    /// Run one check-in; returns the seconds to wait before the next.
    @discardableResult
    public func round() async throws -> Int {
        do {
            let lists = try store.lists()
            let ids = Set(lists.map(\.id))
            var snapshots: [String: [RemoteItem]] = [:]
            for id in linked where ids.contains(id) {
                snapshots[id] = try store.items(in: id)
            }
            let response = try await transport.sync(
                SyncRequest(helper: helper, lists: lists, snapshots: snapshots, created: pendingCreated))
            pendingCreated = []
            let newlyLinked = Set(response.linked).subtracting(linked).intersection(ids)
            linked = Set(response.linked)
            apply(response.ops)
            lastError = nil
            lastSync = Date()
            // A list just linked: send its items straight away rather than in a few seconds.
            if !newlyLinked.isEmpty || !pendingCreated.isEmpty { return 1 }
            return max(1, response.nextSeconds)
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            throw error
        }
    }

    private func apply(_ ops: [Op]) {
        for op in ops {
            switch op {
            case let .add(list, tempId, text, done):
                if let id = try? store.add(to: list, text: text, done: done) {
                    pendingCreated.append(Created(tempId: tempId, remoteId: id, remoteListId: list))
                }
            case let .update(_, remoteId, text, done):
                // A reminder deleted meanwhile is fine: the next snapshot tells the server.
                try? store.update(id: remoteId, text: text, done: done)
            case let .delete(_, remoteId):
                try? store.delete(id: remoteId)
            }
        }
    }
}
