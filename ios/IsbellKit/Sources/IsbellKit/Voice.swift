// The speech service: a recording goes in, the words heard come back tidied. It is the web's
// (web/src/features/session/voice.tsx), reached over plain HTTPS, not through the relay.

import Foundation

/// Why speech came back as no words.
public enum VoiceFailure: Error, Equatable, Sendable {
    /// Over the minute's recordings.
    case limited
    /// The day's minutes are spent.
    case usedUp
    /// Nothing was heard.
    case empty
    /// What the service, or the proxy in front of it, said.
    case failed(String)
}

private struct Reply: Decodable {
    let polished: String?
    let error: String?
}

/// What the speech service's answer means, as the web's `send`.
public func voiceReply(status: Int, retryAfter: String?, contentType: String?, body: Data) -> Result<String, VoiceFailure> {
    // Over the minute's recordings, or the day's minutes: told apart by how long to wait.
    if status == 429 { return .failure((Int(retryAfter ?? "") ?? 0) > 60 ? .usedUp : .limited) }
    let plain = VoiceFailure.failed("\(status) \(HTTPURLResponse.localizedString(forStatusCode: status))")
    // A proxy in front of a service that is down answers with a page, not the service's JSON.
    guard contentType?.contains("json") == true,
          let reply = try? JSONDecoder().decode(Reply.self, from: body)
    else { return .failure(plain) }
    if let error = reply.error { return .failure(.failed(error)) }
    guard let polished = reply.polished, !polished.isEmpty else { return .failure(.empty) }
    return .success(polished)
}

/// Sends a recording to the speech service at `base` and returns its words, tidied. A task
/// cancelled on the way fails as the network does; its caller knows it cancelled.
public func transcribe(_ base: URL, audio: Data, filename: String, type: String) async throws(VoiceFailure) -> String {
    let boundary = UUID().uuidString
    var request = URLRequest(url: base.appending(path: "v1/transcribe"), timeoutInterval: 60)
    request.httpMethod = "POST"
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    var body = Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\nContent-Type: \(type)\r\n\r\n".utf8)
    body.append(audio)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    request.httpBody = body
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await URLSession.shared.data(for: request)
    } catch {
        throw .failed(error.localizedDescription)
    }
    let http = response as? HTTPURLResponse
    let reply = voiceReply(status: http?.statusCode ?? 0, retryAfter: http?.value(forHTTPHeaderField: "Retry-After"),
                           contentType: http?.value(forHTTPHeaderField: "Content-Type"), body: data)
    return try reply.get()
}
