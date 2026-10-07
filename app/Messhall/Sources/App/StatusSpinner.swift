import AppKit
import Feed
import SwiftUI

/// The spinning glyph and the shimmering status text of a thinking agent, drawn by Core Animation.
/// Every frame runs on the render server, so a tick never touches the main thread or lays the window out.
struct StatusSpinner: NSViewRepresentable {
  let text: String
  let color: Color
  /// A frame to hold still on, for a shot. Nil spins.
  let frozen: Int?
  let scheme: ColorScheme

  func makeNSView(context: Context) -> SpinnerView {
    SpinnerView()
  }

  func updateNSView(_ view: SpinnerView, context: Context) {
    view.show(text: text, color: NSColor(color), frozen: frozen)
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView view: SpinnerView, context: Context) -> CGSize? {
    view.size(fitting: proposal.width)
  }
}

/// One layer per glyph frame, stacked, with opacity keyframes that show them in turn. The text sits twice:
/// a dim base and a bright copy that only shows through a band sliding across it, which is the shimmer.
final class SpinnerView: NSView {
  static let font = NSFont.preferredFont(forTextStyle: .caption1)
  static let glyphBox = Thinking.box(for: font)
  static let gap = 4.0
  private static let lineHeight = ceil(font.ascender - font.descender)

  private let glyphs = Thinking.frames.map { _ in CATextLayer() }
  private let base = CATextLayer()
  private let shineHost = CALayer()
  private let shine = CAGradientLayer()
  private let shineMask = CATextLayer()
  private var text = ""
  private var color = NSColor.labelColor
  private var frozen: Int?

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.masksToBounds = true
    for (glyph, layer) in zip(Thinking.frames, glyphs) {
      layer.string = glyph
      layer.alignmentMode = .center
      Self.style(layer)
      self.layer?.addSublayer(layer)
    }
    Self.style(base)
    Self.style(shineMask)
    base.truncationMode = .end
    shineMask.truncationMode = .end
    shine.startPoint = CGPoint(x: 0, y: 0.5)
    shine.endPoint = CGPoint(x: 1, y: 0.5)
    shineHost.mask = shineMask
    shineHost.addSublayer(shine)
    self.layer?.addSublayer(base)
    self.layer?.addSublayer(shineHost)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  private static func style(_ layer: CATextLayer) {
    layer.font = font
    layer.fontSize = font.pointSize
    layer.isWrapped = false
  }

  func show(text: String, color: NSColor, frozen: Int?) {
    self.text = text
    self.color = color
    self.frozen = frozen
    base.string = text
    shineMask.string = text
    needsLayout = true
    paint()
    animate()
  }

  func size(fitting width: CGFloat?) -> CGSize {
    let wanted = Self.glyphBox + Self.gap + Self.textWidth(text)
    return CGSize(width: min(wanted, width ?? wanted), height: Self.lineHeight)
  }

  private static func textWidth(_ text: String) -> CGFloat {
    ceil(NSAttributedString(string: text, attributes: [.font: font]).size().width)
  }

  override var intrinsicContentSize: NSSize { size(fitting: nil) }

  override func layout() {
    super.layout()
    let height = Self.lineHeight
    for glyph in glyphs { glyph.frame = CGRect(x: 0, y: 0, width: Self.glyphBox, height: height) }
    let textFrame = CGRect(
      x: Self.glyphBox + Self.gap, y: 0, width: max(0, bounds.width - Self.glyphBox - Self.gap), height: height)
    base.frame = textFrame
    shineHost.frame = textFrame
    shineMask.frame = CGRect(origin: .zero, size: textFrame.size)
    shine.frame = CGRect(origin: .zero, size: textFrame.size)
    animate()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    let scale = window?.backingScaleFactor ?? 2
    for layer in glyphs + [base, shineMask] { layer.contentsScale = scale }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    paint()
  }

  /// Resolves the colors in the view's own appearance, so dark mode reads right without a SwiftUI pass.
  private func paint() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      for glyph in glyphs { glyph.foregroundColor = color.cgColor }
      base.foregroundColor = NSColor.secondaryLabelColor.cgColor
      shineMask.foregroundColor = NSColor.labelColor.cgColor
      let clear = NSColor.labelColor.withAlphaComponent(0).cgColor
      shine.colors = [clear, NSColor.labelColor.cgColor, clear]
    }
  }

  /// Opacity keyframes on each glyph and one sliding band, both repeating on the render server.
  private func animate() {
    for layer in glyphs { layer.removeAllAnimations() }
    shine.removeAllAnimations()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    if let frozen {
      for (index, layer) in glyphs.enumerated() { layer.opacity = index == frozen ? 1 : 0 }
      shineHost.isHidden = true
      return
    }
    shineHost.isHidden = false
    for (index, layer) in glyphs.enumerated() {
      layer.opacity = index == 0 ? 1 : 0
      let frames = CAKeyframeAnimation(keyPath: "opacity")
      frames.values = Thinking.keyframes(showing: index)
      frames.calculationMode = .discrete
      frames.duration = Thinking.step * Double(Thinking.frames.count)
      frames.repeatCount = .infinity
      layer.add(frames, forKey: "spin")
    }
    let width = shine.bounds.width
    guard width > 0 else { return }
    let sweep = CABasicAnimation(keyPath: "position.x")
    sweep.fromValue = shine.position.x - width
    sweep.toValue = shine.position.x + width
    sweep.duration = Thinking.sweep
    sweep.repeatCount = .infinity
    shine.add(sweep, forKey: "sweep")
  }
}
