import UIKit
import ImageIO
import Darwin

/// Keeps the launch image iOS shows on a cold start in the app's saved theme.
///
/// iOS renders LaunchScreen.storyboard once and caches the result as image
/// files in the app's own container: Library/SplashBoard/Snapshots (subfolders
/// per scene and size). Every cold start shows that cached picture before any
/// app code runs, so it is navy for every theme unless the files themselves
/// are repainted. This walks that folder and redraws each image in the saved
/// theme's base color with the LaunchLogo mascot where the storyboard puts it:
/// 157x260 pt, centered on the full image.
///
/// The folder is undocumented. Every step fails silently (the launch simply
/// stays as iOS made it), nothing is ever deleted, and all of the work runs on
/// a background queue so it can never slow the launch.
enum LaunchScreenCache {
    static let themeIdKey = "cp.theme.id"
    static let themeBaseKey = "cp.theme.base"

    /// Theme ids and bases the app can save. Mirrors src/styles/themePreview.js.
    static let knownThemeIds: Set<String> = [
        "navy", "black", "forest", "purple", "light", "sky", "pink", "cream",
    ]
    /// Themes whose status bar text is dark.
    static let lightThemeIds: Set<String> = ["light", "sky", "pink", "cream"]

    /// The mark left on each repainted file: the base it was repainted with.
    private static let markName = "cp.launch.base"
    /// LaunchScreen.storyboard: LaunchLogo is 157x260 pt.
    private static let logoPoints = CGSize(width: 157, height: 260)

    private static let queue = DispatchQueue(label: "app.checkpoint.launch-cache", qos: .utility)

    // MARK: - Saved theme

    /// "#RRGGBB" only, lowercased. Anything else is nil.
    static func normalizedBase(_ value: Any?) -> String? {
        guard let text = value as? String, text.count == 7, text.hasPrefix("#") else { return nil }
        let digits = text.dropFirst()
        guard digits.allSatisfy({ $0.isHexDigit }) else { return nil }
        return text.lowercased()
    }

    static var savedBase: String? {
        normalizedBase(UserDefaults.standard.string(forKey: themeBaseKey))
    }

    static var savedThemeId: String? {
        guard let id = UserDefaults.standard.string(forKey: themeIdKey), knownThemeIds.contains(id) else { return nil }
        return id
    }

    static func color(fromBase base: String) -> UIColor? {
        guard let normalized = normalizedBase(base), let value = UInt32(normalized.dropFirst(), radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255.0,
            green: CGFloat((value >> 8) & 0xFF) / 255.0,
            blue: CGFloat(value & 0xFF) / 255.0,
            alpha: 1.0
        )
    }

    // MARK: - Repaint

    /// Repaints every image in the launch cache with `base`. Call from the
    /// main thread; the work itself runs serialized on a utility queue.
    static func repaint(base: String) {
        schedule(base: base, delays: [0])
    }

    /// Repaints with the base saved in UserDefaults, if there is one.
    static func repaintSaved() {
        guard let base = savedBase else { return }
        repaint(base: base)
    }

    /// iOS redraws the launch images shortly AFTER the app enters the
    /// background, not before applicationDidEnterBackground returns. So the
    /// repaint runs once now and again a few times over the next seconds, under
    /// a background task that keeps the app alive that long. Whatever iOS has
    /// not touched is skipped by its mark.
    static func repaintAfterBackground(_ application: UIApplication) {
        guard let base = savedBase else { return }
        let holder = BackgroundTaskHolder()
        holder.id = application.beginBackgroundTask(withName: "launch-cache") {
            holder.end(application)
        }
        let delays = backgroundPassDelays
        schedule(base: base, delays: delays)
        queue.asyncAfter(deadline: .now() + (delays.last ?? 0) + 1) {
            holder.end(application)
        }
    }

    /// Seconds after entering the background at which to look again.
    private static let backgroundPassDelays: [TimeInterval] = [0, 0.3, 0.8, 1.5, 3, 5, 8]

    private final class BackgroundTaskHolder {
        private let lock = NSLock()
        var id: UIBackgroundTaskIdentifier = .invalid

        func end(_ application: UIApplication) {
            lock.lock()
            let current = id
            id = .invalid
            lock.unlock()
            guard current != .invalid else { return }
            DispatchQueue.main.async { application.endBackgroundTask(current) }
        }
    }

    private static func schedule(base: String, delays: [TimeInterval]) {
        guard let base = normalizedBase(base) else { return }
        // UIKit values are read here, on the caller's (main) thread.
        let scale = UIScreen.main.scale
        let screen = UIScreen.main.bounds.size
        let logo = UIImage(named: "LaunchLogo")
        for delay in delays {
            queue.asyncAfter(deadline: .now() + delay) {
                // A newer theme was saved while this waited: that call repaints.
                guard savedBase == base else { return }
                repaintAll(base: base, scale: scale, screen: screen, logo: logo)
            }
        }
    }

    private static func snapshotsURL() -> URL? {
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
        let url = library.appendingPathComponent("SplashBoard/Snapshots", isDirectory: true)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else { return nil }
        return url
    }

    private static func imageFiles(in folder: URL) -> [URL] {
        guard let walker = FileManager.default.enumerator(
            at: folder,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: []
        ) else { return [] }
        var files: [URL] = []
        for case let url as URL in walker {
            guard ["ktx", "png", "jpeg", "jpg"].contains(url.pathExtension.lowercased()) else { continue }
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
            files.append(url)
        }
        return files
    }

    private static func repaintAll(base: String, scale: CGFloat, screen: CGSize, logo: UIImage?) {
        guard let folder = snapshotsURL(), let color = color(fromBase: base) else { return }
        for file in imageFiles(in: folder) {
            // Skip what is already painted in this base; repaint anything iOS
            // added or redrew (no mark, or another base).
            if readMark(file) == base { continue }
            guard let size = pixelSize(of: file) else { continue }
            guard let drawn = draw(size: size, color: color, logo: logo, scale: scale, screen: screen) else { continue }
            guard encodeAndWrite(drawn, over: file) != nil else { continue }
            writeMark(file, base)
        }
    }

    // MARK: - Drawing

    private static func pixelSize(of file: URL) -> CGSize? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
              width >= 1, height >= 1
        else { return nil }
        return CGSize(width: width, height: height)
    }

    /// An image of exactly `size` pixels: the base color, then the mascot at
    /// 157x260 pt x the screen scale, centered on the full image. An image
    /// whose short side is not the screen's (a downscaled copy) gets the
    /// mascot scaled by the same ratio, so it is the same picture, smaller.
    ///
    /// iOS's own cached images are Display P3, so this draws in Display P3 and
    /// converts the sRGB base into it, the way the storyboard's color would be.
    private static func draw(size: CGSize, color: UIColor, logo: UIImage?, scale: CGFloat, screen: CGSize) -> CGImage? {
        let width = Int(size.width)
        let height = Int(size.height)
        guard width > 0, height > 0, width <= 16_384, height <= 16_384 else { return nil }

        var factor: CGFloat = 1
        let screenShortPixels = min(screen.width, screen.height) * scale
        if screenShortPixels > 0 {
            let ratio = min(size.width, size.height) / screenShortPixels
            if abs(ratio - 1) > 0.01 { factor = ratio }
        }
        let logoWidth = (logoPoints.width * scale * factor).rounded()
        let logoHeight = (logoPoints.height * scale * factor).rounded()
        let logoRect = CGRect(
            x: ((size.width - logoWidth) / 2).rounded(),
            y: ((size.height - logoHeight) / 2).rounded(),
            width: logoWidth,
            height: logoHeight
        )

        let space = CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: space,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }

        let fill = color.cgColor.converted(to: space, intent: .defaultIntent, options: nil) ?? color.cgColor
        context.setFillColor(fill)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        if let logoImage = logo?.cgImage {
            context.draw(logoImage, in: logoRect)
        }
        return context.makeImage()
    }

    // MARK: - Writing

    /// Writes `image` over `file` atomically, in the container format the file
    /// had when ImageIO can encode it, otherwise as PNG. Returns the format
    /// written, or nil if nothing was written.
    private static func encodeAndWrite(_ cgImage: CGImage, over file: URL) -> String? {

        var candidates: [String] = []
        if let source = CGImageSourceCreateWithURL(file as CFURL, nil), let type = CGImageSourceGetType(source) as String? {
            candidates.append(type)
        }
        switch file.pathExtension.lowercased() {
        case "jpeg", "jpg": candidates.append("public.jpeg")
        default: break
        }
        let encodable = (CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? []

        var tried = Set<String>()
        for type in candidates where !tried.contains(type) {
            tried.insert(type)
            guard type != "public.png", encodable.contains(type) else { continue }
            if let data = encode(cgImage, as: type), decodes(data, width: cgImage.width, height: cgImage.height),
               write(data, to: file) {
                return type
            }
        }
        // PNG: the source was PNG, or ImageIO cannot encode (or re-read) the original format.
        if let data = encode(cgImage, as: "public.png"), write(data, to: file) {
            return "public.png"
        }
        return nil
    }

    private static func encode(_ image: CGImage, as type: String) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, type as CFString, 1, nil) else { return nil }
        var options: [CFString: Any] = [:]
        if type == "public.jpeg" { options[kCGImageDestinationLossyCompressionQuality] = 0.95 }
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        guard CGImageDestinationFinalize(destination), data.length > 0 else { return nil }
        return data as Data
    }

    /// The encoded bytes read back at the size they were drawn.
    private static func decodes(_ data: Data, width: Int, height: Int) -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue == width,
              (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue == height
        else { return false }
        return true
    }

    private static func write(_ data: Data, to file: URL) -> Bool {
        do {
            try data.write(to: file, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Marks

    private static func readMark(_ file: URL) -> String? {
        let path = file.path
        let size = getxattr(path, markName, nil, 0, 0, 0)
        guard size > 0, size < 64 else { return nil }
        var buffer = [UInt8](repeating: 0, count: size)
        let read = getxattr(path, markName, &buffer, size, 0, 0)
        guard read == size else { return nil }
        return String(bytes: buffer, encoding: .utf8)
    }

    private static func writeMark(_ file: URL, _ base: String) {
        let bytes = Array(base.utf8)
        _ = setxattr(file.path, markName, bytes, bytes.count, 0, 0)
    }
}
