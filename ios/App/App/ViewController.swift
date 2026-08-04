import UIKit
import Capacitor

/// Bridges the native launch screen to the web content with no white frame
/// in between. `CAPBridgeViewController`'s `WKWebView` is transparent by
/// default until the app's CSS paints (index.css sets html/body/#root to
/// --bg-base), so on a cold start there is a brief window — after the
/// LaunchScreen storyboard is dismissed but before the first CSS paint —
/// where the system default (white) would otherwise show through.
///
/// Setting the root view, the web view, and its scroll view to the same
/// Cobalt Modern base color as the launch screen (and disabling opacity)
/// closes that gap: every layer behind the web content is already navy,
/// so there is nothing left that can flash white.
class ViewController: CAPBridgeViewController {
    private let launchBackgroundColor = UIColor(named: "LaunchBackground")
        ?? UIColor(red: 0x0A / 255.0, green: 0x0F / 255.0, blue: 0x1F / 255.0, alpha: 1.0)

    override func viewDidLoad() {
        view.backgroundColor = launchBackgroundColor
        super.viewDidLoad()

        webView?.isOpaque = false
        webView?.backgroundColor = launchBackgroundColor
        webView?.scrollView.backgroundColor = launchBackgroundColor
    }
}
