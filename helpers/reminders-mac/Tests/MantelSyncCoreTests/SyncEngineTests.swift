import XCTest

@testable import MantelSyncCore

final class FakeReminders: ReminderStore {
    var data: [String: [RemoteItem]] = ["L1": [RemoteItem(id: "a", text: "Eggs", done: false)], "L2": []]
    var names = ["L1": "Groceries", "L2": "Family"]
    var seq = 0

    func lists() throws -> [RemoteList] {
        names.keys.sorted().map { RemoteList(id: $0, name: names[$0]!) }
    }
    func items(in listId: String) throws -> [RemoteItem] { data[listId] ?? [] }
    func add(to listId: String, text: String, done: Bool) throws -> String {
        seq += 1
        let id = "new\(seq)"
        data[listId, default: []].append(RemoteItem(id: id, text: text, done: done))
        return id
    }
    func update(id: String, text: String?, done: Bool?) throws {
        for (list, items) in data {
            data[list] = items.map { item in
                guard item.id == id else { return item }
                var next = item
                if let text { next.text = text }
                if let done { next.done = done }
                return next
            }
        }
    }
    func delete(id: String) throws {
        for (list, items) in data { data[list] = items.filter { $0.id != id } }
    }
}

final class FakeServer: SyncTransport {
    var requests: [SyncRequest] = []
    var replies: [SyncResponse] = []
    var fail = false

    func sync(_ request: SyncRequest) async throws -> SyncResponse {
        if fail { throw ServerError.unreachable("offline") }
        requests.append(request)
        return replies.isEmpty ? SyncResponse(linked: [], ops: [], nextSeconds: 10) : replies.removeFirst()
    }
}

final class SyncEngineTests: XCTestCase {
    let helper = HelperInfo(name: "Test Mac", version: "1.0.0")

    func testFirstCheckInSendsListsButNoItems() async throws {
        let store = FakeReminders()
        let server = FakeServer()
        let engine = SyncEngine(store: store, transport: server, helper: helper)
        let wait = try await engine.round()
        XCTAssertEqual(wait, 10)
        XCTAssertEqual(server.requests[0].lists.map(\.name), ["Groceries", "Family"])
        XCTAssertEqual(server.requests[0].snapshots, [:])
    }

    func testLinkedListsSendItemsAndOpsAreCarriedOut() async throws {
        let store = FakeReminders()
        let server = FakeServer()
        server.replies = [
            SyncResponse(linked: ["L1"], ops: [], nextSeconds: 10),
            SyncResponse(
                linked: ["L1"],
                ops: [
                    .add(remoteListId: "L1", tempId: "new:x", text: "Milk", done: false),
                    .update(remoteListId: "L1", remoteId: "a", text: nil, done: true),
                ], nextSeconds: 2),
            SyncResponse(linked: ["L1"], ops: [.delete(remoteListId: "L1", remoteId: "a")], nextSeconds: 10),
        ]
        let engine = SyncEngine(store: store, transport: server, helper: helper)
        // Newly linked: come back at once with the items.
        let w1 = try await engine.round()
        XCTAssertEqual(w1, 1)
        let w2 = try await engine.round()
        XCTAssertEqual(w2, 1)
        XCTAssertEqual(server.requests[1].snapshots["L1"]?.map(\.text), ["Eggs"])
        XCTAssertEqual(store.data["L1"]?.map(\.text), ["Eggs", "Milk"])
        XCTAssertEqual(store.data["L1"]?.first?.done, true)
        XCTAssertEqual(engine.pendingCreated, [Created(tempId: "new:x", remoteId: "new1", remoteListId: "L1")])
        // The new id goes back on the next check-in, once.
        let w3 = try await engine.round()
        XCTAssertEqual(w3, 10)
        XCTAssertEqual(server.requests[2].created.map(\.remoteId), ["new1"])
        XCTAssertEqual(engine.pendingCreated, [])
        XCTAssertEqual(store.data["L1"]?.map(\.text), ["Milk"])
    }

    func testOfflineKeepsPendingIdsAndReportsTheError() async throws {
        let store = FakeReminders()
        let server = FakeServer()
        server.replies = [
            SyncResponse(
                linked: ["L2"], ops: [.add(remoteListId: "L2", tempId: "new:y", text: "Dentist", done: false)],
                nextSeconds: 2)
        ]
        let engine = SyncEngine(store: store, transport: server, helper: helper)
        _ = try await engine.round()
        server.fail = true
        do {
            _ = try await engine.round()
            XCTFail("expected an error")
        } catch {}
        XCTAssertNotNil(engine.lastError)
        XCTAssertEqual(engine.pendingCreated.count, 1)
        server.fail = false
        _ = try await engine.round()
        XCTAssertEqual(server.requests.last?.created.map(\.tempId), ["new:y"])
        XCTAssertNil(engine.lastError)
    }

    func testOpsDecodeFromTheServersJson() throws {
        let json = """
            {"linked":["L1"],"nextSeconds":2,"ops":[
              {"op":"add","remoteListId":"L1","tempId":"new:1","text":"Milk","done":false},
              {"op":"update","remoteListId":"L1","remoteId":"r1","done":true},
              {"op":"delete","remoteListId":"L1","remoteId":"r2"}]}
            """
        let r = try JSONDecoder().decode(SyncResponse.self, from: Data(json.utf8))
        XCTAssertEqual(
            r.ops,
            [
                .add(remoteListId: "L1", tempId: "new:1", text: "Milk", done: false),
                .update(remoteListId: "L1", remoteId: "r1", text: nil, done: true),
                .delete(remoteListId: "L1", remoteId: "r2"),
            ])
        let back = try JSONDecoder().decode(SyncResponse.self, from: JSONEncoder().encode(r))
        XCTAssertEqual(back, r)
    }

    func testAddressesArePutRight() {
        XCTAssertEqual(MantelServer.normalise("mantel.local:8787/")?.absoluteString, "http://mantel.local:8787")
        XCTAssertEqual(
            MantelServer.normalise(" https://home.example.com/settings ")?.absoluteString, "https://home.example.com")
        XCTAssertNil(MantelServer.normalise(""))
    }
}
