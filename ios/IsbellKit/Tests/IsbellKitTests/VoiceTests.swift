import Foundation
import Testing

@testable import IsbellKit

private func reply(_ status: Int, _ body: String, type: String = "application/json", retryAfter: String? = nil)
    -> Result<String, VoiceFailure>
{
    voiceReply(status: status, retryAfter: retryAfter, contentType: type, body: Data(body.utf8))
}

@Test func theWordsHeardAreTheTidiedOnes() {
    #expect(reply(200, #"{"raw":"嗯 好的","polished":"好的。"}"#) == .success("好的。"))
}

@Test func noWordsMeansNothingWasHeard() {
    #expect(reply(200, #"{"raw":"","polished":""}"#) == .failure(.empty))
}

@Test func theServiceSaysWhatWentWrong() {
    #expect(reply(400, #"{"error":"no audio"}"#) == .failure(.failed("no audio")))
}

@Test func aPageInsteadOfTheServiceGivesTheStatus() {
    #expect(reply(502, "<html>Bad Gateway</html>", type: "text/html") == .failure(.failed("502 bad gateway")))
}

@Test func tooManyIsToldApartFromTheDaySpentByTheWait() {
    #expect(reply(429, #"{"error":"too many"}"#, retryAfter: "30") == .failure(.limited))
    #expect(reply(429, #"{"error":"too many"}"#, retryAfter: "40000") == .failure(.usedUp))
}
