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
/// The launch screen is in the saved theme, not always navy: the web app posts
/// its theme to "cpTheme" on every launch and change, this saves it, and
/// LaunchScreenCache repaints iOS's cached launch images in that base color.
/// The cover, root view, web view, and scroll view use the same saved base, so
/// the first frame the app draws equals the repainted launch image. Setting
/// them also keeps anything behind the web content from flashing white.
class ViewController: CAPBridgeViewController {
    private static let coverHandlerName = "bootCover"
    private static let themeHandlerName = "cpTheme"
    /// If the page never reports in (offline, a hung load), the cover goes anyway.
    private static let coverFailsafe: TimeInterval = 5

    /// The saved theme's base, or LaunchBackground (navy) before one is saved.
    /// Fixed for this launch: the cover must equal the launch image iOS showed.
    private let launchBackgroundColor: UIColor = {
        if let base = LaunchScreenCache.savedBase, let color = LaunchScreenCache.color(fromBase: base) {
            return color
        }
        return UIColor(named: "LaunchBackground")
            ?? UIColor(red: 0x0A / 255.0, green: 0x0F / 255.0, blue: 0x1F / 255.0, alpha: 1.0)
    }()

    private var launchCover: UIView?
    private var coverHandlerRegistered = false
    private var themeHandlerRegistered = false

    override func viewDidLoad() {
        // Reading `view` builds the web view (CAPBridgeViewController.loadView).
        view.backgroundColor = launchBackgroundColor

        // First frame status bar text from the saved theme (dark text on the
        // light themes). The StatusBar plugin sets the same value once the app
        // runs, through the same property, so the two never fight.
        if let id = LaunchScreenCache.savedThemeId {
            setStatusBarStyle(LaunchScreenCache.lightThemeIds.contains(id) ? .darkContent : .lightContent)
        }

        // Registered before super.viewDidLoad() starts the page load, so the
        // page can never run its script ahead of a handler.
        registerCoverHandler()
        registerThemeHandler()

        super.viewDidLoad()

        webView?.isOpaque = false
        webView?.backgroundColor = launchBackgroundColor
        webView?.scrollView.backgroundColor = launchBackgroundColor

        installLaunchCover()
    }

    /// A view that looks exactly like LaunchScreen.storyboard: the launch base
    /// over the full view, LaunchLogo 51x84 aspect fit with its center 24 pt
    /// above the view's center, and the wordmark 159x32 aspect fit with its
    /// center 50 pt below (the storyboard centers on the view, not the safe
    /// area). Light themes use the dark-ink wordmark.
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

        let lightTheme = LaunchScreenCache.lightThemeIds.contains(LaunchScreenCache.savedThemeId ?? "")
        let wordmark = UIImageView(image: UIImage(named: lightTheme ? "LaunchWordmarkLight" : "LaunchWordmark"))
        wordmark.translatesAutoresizingMaskIntoConstraints = false
        wordmark.contentMode = .scaleAspectFit
        wordmark.clipsToBounds = true
        wordmark.isUserInteractionEnabled = false
        cover.addSubview(wordmark)

        view.addSubview(cover)
        NSLayoutConstraint.activate([
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            logo.widthAnchor.constraint(equalToConstant: 51),
            logo.heightAnchor.constraint(equalToConstant: 84),
            logo.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: cover.centerYAnchor, constant: -24),
            wordmark.widthAnchor.constraint(equalToConstant: 159),
            wordmark.heightAnchor.constraint(equalToConstant: 32),
            wordmark.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            wordmark.centerYAnchor.constraint(equalTo: cover.centerYAnchor, constant: 50),
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

    private func registerThemeHandler() {
        guard !themeHandlerRegistered, let controller = webView?.configuration.userContentController else { return }
        controller.add(ThemeMessageProxy(owner: self), name: Self.themeHandlerName)
        themeHandlerRegistered = true
    }

    /// The web app's theme, posted on every launch and every change. Only a
    /// known id with a #RRGGBB base is accepted; anything else is ignored.
    fileprivate func receiveTheme(_ body: Any) {
        guard let message = body as? [String: Any],
              let id = message["id"] as? String, LaunchScreenCache.knownThemeIds.contains(id),
              let base = LaunchScreenCache.normalizedBase(message["base"]),
              let color = LaunchScreenCache.color(fromBase: base)
        else { return }

        UserDefaults.standard.set(id, forKey: LaunchScreenCache.themeIdKey)
        UserDefaults.standard.set(base, forKey: LaunchScreenCache.themeBaseKey)

        // Behind the web content (the scroll bounce area) follows the theme.
        // The launch cover is left alone: it holds the picture iOS showed.
        view.backgroundColor = color
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color

        // Repaint the cached launch images. Files already in this base are skipped.
        LaunchScreenCache.repaint(base: base)
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

/// Same as BootCoverMessageProxy, for the saved-theme messages.
private final class ThemeMessageProxy: NSObject, WKScriptMessageHandler {
    private weak var owner: ViewController?

    init(owner: ViewController) {
        self.owner = owner
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receiveTheme(message.body)
    }
}
