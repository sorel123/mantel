import Foundation

public enum ServerError: LocalizedError, Equatable {
    case badAddress
    case http(Int, String)
    case unreachable(String)

    public var errorDescription: String? {
        switch self {
        case .badAddress: return "That doesn’t look like a web address. Try http://mantel.local:8787"
        case let .http(401, _): return "Mantel no longer knows this Mac. Pair it again."
        case let .http(_, message): return message
        case let .unreachable(why): return "Couldn’t reach Mantel: \(why)"
        }
    }
}

/// The Mantel server: pairing, and the check-in.
public struct MantelServer: SyncTransport {
    public static let keyHeader = "x-mantel-device-key"

    public let base: URL
    public let deviceKey: String
    let session: URLSession

    public init(base: URL, deviceKey: String, session: URLSession = .shared) {
        self.base = base
        self.deviceKey = deviceKey
        self.session = session
    }

    /// Turn what a person typed into the server's base address.
    public static func normalise(_ typed: String) -> URL? {
        var s = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if !s.contains("://") { s = "http://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        if s.hasSuffix("/settings") { s.removeLast("/settings".count) }
        guard let url = URL(string: s), url.host != nil else { return nil }
        return url
    }

    /// Pair with a six-digit code from Settings › Displays; returns the device key.
    public static func pair(base: URL, code: String, name: String, session: URLSession = .shared)
        async throws -> String
    {
        struct Body: Encodable {
            let code: String
            let name: String
        }
        struct Paired: Decodable {
            let deviceKey: String
        }
        let data = try await post(
            session: session, url: base.appendingPathComponent("api/pair"), key: nil,
            body: Body(code: code.filter(\.isNumber), name: name))
        return try JSONDecoder().decode(Paired.self, from: data).deviceKey
    }

    public func sync(_ request: SyncRequest) async throws -> SyncResponse {
        let data = try await Self.post(
            session: session, url: base.appendingPathComponent("api/lists/sync/reminders"),
            key: deviceKey, body: request)
        return try JSONDecoder().decode(SyncResponse.self, from: data)
    }

    static func post<B: Encodable>(session: URLSession, url: URL, key: String?, body: B) async throws
        -> Data
    {
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        if let key { req.setValue(key, forHTTPHeaderField: keyHeader) }
        req.httpBody = try JSONEncoder().encode(body)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw ServerError.unreachable(error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message =
                (try? JSONDecoder().decode(ApiErrorBody.self, from: data))?.error.message
                ?? "Mantel answered \(status)."
            throw ServerError.http(status, message)
        }
        return data
    }
}
