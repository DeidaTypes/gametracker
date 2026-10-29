import UIKit
import WebKit
import Capacitor

/// Bridges the native launch screen to the web content with no frame in
/// between that differs from it.
///
/// `CAPBridgeViewController` makes the WKWebView its own `view`. On a cold
/// start the first frame the app draws is that view: LaunchBackground navy
/// with a transparent web page and no mascot (index.html's splash image has
/// not decoded yet), and iOS cross-fades the launch screen into it. So a
/// native cover, identical to LaunchScreen.storyboard, sits on top of the web
/// view from its first frame. index.html's #boot-splash is the same picture
/// in web content; once it has painted, it posts "bootCover" and the cover
/// is removed at once. Nothing on screen changes at that moment.
///
/// Setting the root view, the web view, and its scroll view to the launch
/// navy also keeps anything behind the web content from flashing white.
class ViewController: CAPBridgeViewController {
    private static let coverHandlerName = "bootCover"
    /// If the page never reports in (offline, a hung load), the cover goes anyway.
    private static let coverFailsafe: TimeInterval = 5

    private let launchBackgroundColor = UIColor(named: "LaunchBackground")
        ?? UIColor(red: 0x0A / 255.0, green: 0x0F / 255.0, blue: 0x1F / 255.0, alpha: 1.0)

    private var launchCover: UIView?
    private var coverHandlerRegistered = false

    override func viewDidLoad() {
        // Reading `view` builds the web view (CAPBridgeViewController.loadView).
        view.backgroundColor = launchBackgroundColor

        // Registered before super.viewDidLoad() starts the page load, so the
        // page can never run its script ahead of the handler.
        registerCoverHandler()

        super.viewDidLoad()

        webView?.isOpaque = false
        webView?.backgroundColor = launchBackgroundColor
        webView?.scrollView.backgroundColor = launchBackgroundColor

        installLaunchCover()
    }

    /// A view that looks exactly like LaunchScreen.storyboard: LaunchBackground
    /// over the full view, LaunchLogo 157x260 aspect fit at the view's center
    /// (the storyboard centers on the view, not the safe area).
    private func installLaunchCover() {
        guard launchCover == nil else { return }

        let cover = UIView()
        cover.translatesAutoresizingMaskIntoConstraints = false
        cover.backgroundColor = launchBackgroundColor
        cover.isUserInteractionEnabled = true

        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.contentMode = .scaleAspectFit
        logo.clipsToBounds = true
        logo.isUserInteractionEnabled = false
        cover.addSubview(logo)

        view.addSubview(cover)
        NSLayoutConstraint.activate([
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            logo.widthAnchor.constraint(equalToConstant: 157),
            logo.heightAnchor.constraint(equalToConstant: 260),
            logo.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
        ])
        launchCover = cover

        DispatchQueue.main.asyncAfter(deadline: .now() + Self.coverFailsafe) { [weak self] in
            self?.removeLaunchCover()
        }
    }

    private func registerCoverHandler() {
        guard !coverHandlerRegistered, let controller = webView?.configuration.userContentController else { return }
        controller.add(BootCoverMessageProxy(owner: self), name: Self.coverHandlerName)
        coverHandlerRegistered = true
    }

    private func unregisterCoverHandler() {
        guard coverHandlerRegistered else { return }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.coverHandlerName)
        coverHandlerRegistered = false
    }

    /// No animation: the web splash under the cover is identical to it.
    fileprivate func removeLaunchCover() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.removeLaunchCover() }
            return
        }
        launchCover?.removeFromSuperview()
        launchCover = nil
        unregisterCoverHandler()
    }
}

/// WKUserContentController retains its handlers strongly; this keeps that from
/// retaining the view controller.
private final class BootCoverMessageProxy: NSObject, WKScriptMessageHandler {
    private weak var owner: ViewController?

    init(owner: ViewController) {
        self.owner = owner
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.removeLaunchCover()
    }
}
