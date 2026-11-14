// An HTML page or an SVG drawing shown as a browser would: every file it asks for under the root
// read from its machine, as web/preview/sw.js does for the web; a link it follows to the web opened
// in Safari.

import IsbellKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct PageFile: UIViewRepresentable {
    let rel: String
    /// The page itself, read already.
    let first: Data
    let assets: FileAssets

    func makeCoordinator() -> PageLinks { PageLinks() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(FileScheme(page: rel, first: first, assets: assets), forURLScheme: scheme)
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        var url = URLComponents()
        url.scheme = scheme
        url.host = "page"
        url.path = "/" + rel
        if let url = url.url { view.load(URLRequest(url: url)) }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

private let scheme = "isbell-file"

/// Out to Safari, a link followed to the web.
final class PageLinks: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard action.navigationType == .linkActivated, let url = action.request.url,
              ["http", "https"].contains(url.scheme?.lowercased()) else { return .allow }
        await UIApplication.shared.open(url)
        return .cancel
    }
}

/// Answers what the page asks for under the root, as a server of its files would.
private final class FileScheme: NSObject, WKURLSchemeHandler {
    let page: String
    let first: Data
    let assets: FileAssets
    /// The asks still to be answered: one stopped is not, WebKit taking that as an error.
    private var asked = Set<ObjectIdentifier>()

    init(page: String, first: Data, assets: FileAssets) {
        self.page = page
        self.first = first
        self.assets = assets
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let id = ObjectIdentifier(task)
        asked.insert(id)
        Task {
            let (status, body) = await answer(String(url.path.dropFirst()))
            guard asked.remove(id) != nil else { return }
            let type = status == 200 ? mediaType(url.pathExtension) : "text/plain"
            guard let head = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": type]) else {
                return task.didFailWithError(URLError(.badServerResponse))
            }
            task.didReceive(head)
            task.didReceive(body)
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        asked.remove(ObjectIdentifier(task))
    }

    private func answer(_ rel: String) async -> (Int, Data) {
        if rel == page { return (200, first) }
        guard !rel.isEmpty, !rel.split(separator: "/").contains("..") else { return (404, Data()) }
        do {
            return (200, try await assets.data(rel))
        } catch where error.code == "not_found" {
            return (404, Data())
        } catch where error.code == "too_large" {
            return (413, Data())
        } catch {
            return (502, Data(error.msg.utf8))
        }
    }
}

private func mediaType(_ ext: String) -> String {
    let type = UTType(filenameExtension: ext)
    if type?.conforms(to: .html) == true { return "text/html; charset=utf-8" }
    return type?.preferredMIMEType ?? "application/octet-stream"
}
