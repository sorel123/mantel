import Foundation

/// The wire format of `POST /api/lists/sync/reminders` (see `packages/shared/src/list-sync.ts`).

public struct RemoteList: Codable, Equatable {
    public var id: String
    public var name: String
    public var detail: String?

    public init(id: String, name: String, detail: String? = nil) {
        self.id = id
        self.name = name
        self.detail = detail
    }
}

public struct RemoteItem: Codable, Equatable {
    public var id: String
    public var text: String
    public var done: Bool
    public var updatedAt: String?

    public init(id: String, text: String, done: Bool, updatedAt: String? = nil) {
        self.id = id
        self.text = text
        self.done = done
        self.updatedAt = updatedAt
    }
}

public struct Created: Codable, Equatable {
    public var tempId: String
    public var remoteId: String
    public var remoteListId: String
}

public struct HelperInfo: Codable, Equatable {
    public var name: String
    public var version: String

    public init(name: String, version: String) {
        self.name = name
        self.version = version
    }
}

public struct SyncRequest: Codable, Equatable {
    public var helper: HelperInfo
    public var lists: [RemoteList]
    public var snapshots: [String: [RemoteItem]]
    public var created: [Created]
}

/// Something to do in Reminders, from the server.
public enum Op: Equatable {
    case add(remoteListId: String, tempId: String, text: String, done: Bool)
    case update(remoteListId: String, remoteId: String, text: String?, done: Bool?)
    case delete(remoteListId: String, remoteId: String)
}

extension Op: Codable {
    private enum Keys: String, CodingKey { case op, remoteListId, tempId, text, done, remoteId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let list = try c.decode(String.self, forKey: .remoteListId)
        switch try c.decode(String.self, forKey: .op) {
        case "add":
            self = .add(
                remoteListId: list,
                tempId: try c.decode(String.self, forKey: .tempId),
                text: try c.decode(String.self, forKey: .text),
                done: try c.decode(Bool.self, forKey: .done))
        case "update":
            self = .update(
                remoteListId: list,
                remoteId: try c.decode(String.self, forKey: .remoteId),
                text: try c.decodeIfPresent(String.self, forKey: .text),
                done: try c.decodeIfPresent(Bool.self, forKey: .done))
        case "delete":
            self = .delete(remoteListId: list, remoteId: try c.decode(String.self, forKey: .remoteId))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .op, in: c, debugDescription: "unknown op \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case let .add(list, tempId, text, done):
            try c.encode("add", forKey: .op)
            try c.encode(list, forKey: .remoteListId)
            try c.encode(tempId, forKey: .tempId)
            try c.encode(text, forKey: .text)
            try c.encode(done, forKey: .done)
        case let .update(list, remoteId, text, done):
            try c.encode("update", forKey: .op)
            try c.encode(list, forKey: .remoteListId)
            try c.encode(remoteId, forKey: .remoteId)
            try c.encodeIfPresent(text, forKey: .text)
            try c.encodeIfPresent(done, forKey: .done)
        case let .delete(list, remoteId):
            try c.encode("delete", forKey: .op)
            try c.encode(list, forKey: .remoteListId)
            try c.encode(remoteId, forKey: .remoteId)
        }
    }
}

public struct SyncResponse: Codable, Equatable {
    public var linked: [String]
    public var ops: [Op]
    public var nextSeconds: Int

    public init(linked: [String], ops: [Op], nextSeconds: Int) {
        self.linked = linked
        self.ops = ops
        self.nextSeconds = nextSeconds
    }
}

/// An error answer from the server: `{ "error": { "code", "message" } }`.
struct ApiErrorBody: Decodable {
    struct Inner: Decodable {
        let code: String
        let message: String
    }
    let error: Inner
}
