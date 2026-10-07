import SwiftUI

/// The GitHub mark, drawn from its official 16 pt octicon path since SF Symbols has none.
struct GitHubMark: Shape {
  func path(in rect: CGRect) -> Path {
    let scale = min(rect.width, rect.height) / 16
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * scale, y: rect.minY + y * scale) }
    var p = Path()
    p.move(to: pt(8, 0))
    p.addCurve(to: pt(0, 8), control1: pt(3.58, 0), control2: pt(0, 3.58))
    p.addCurve(to: pt(5.47, 15.59), control1: pt(0, 11.54), control2: pt(2.29, 14.53))
    p.addCurve(to: pt(6.02, 15.21), control1: pt(5.87, 15.66), control2: pt(6.02, 15.42))
    p.addCurve(to: pt(6.01, 13.72), control1: pt(6.02, 15.02), control2: pt(6.01, 14.39))
    p.addCurve(to: pt(3.32, 12.78), control1: pt(4, 14.09), control2: pt(3.48, 13.23))
    p.addCurve(to: pt(2.5, 11.65), control1: pt(3.23, 12.55), control2: pt(2.84, 11.84))
    p.addCurve(to: pt(2.49, 11.12), control1: pt(2.22, 11.5), control2: pt(1.82, 11.13))
    p.addCurve(to: pt(3.72, 11.94), control1: pt(3.12, 11.11), control2: pt(3.57, 11.7))
    p.addCurve(to: pt(6.05, 12.6), control1: pt(4.44, 13.15), control2: pt(5.59, 12.81))
    p.addCurve(to: pt(6.56, 11.53), control1: pt(6.12, 12.08), control2: pt(6.33, 11.73))
    p.addCurve(to: pt(2.92, 7.58), control1: pt(4.78, 11.33), control2: pt(2.92, 10.64))
    p.addCurve(to: pt(3.74, 5.43), control1: pt(2.92, 6.71), control2: pt(3.23, 5.99))
    p.addCurve(to: pt(3.82, 3.31), control1: pt(3.66, 5.23), control2: pt(3.38, 4.41))
    p.addCurve(to: pt(6.02, 4.13), control1: pt(3.82, 3.31), control2: pt(4.49, 3.1))
    p.addCurve(to: pt(8.02, 3.86), control1: pt(6.66, 3.95), control2: pt(7.34, 3.86))
    p.addCurve(to: pt(10.02, 4.13), control1: pt(8.7, 3.86), control2: pt(9.38, 3.95))
    p.addCurve(to: pt(12.22, 3.31), control1: pt(11.55, 3.09), control2: pt(12.22, 3.31))
    p.addCurve(to: pt(12.3, 5.43), control1: pt(12.66, 4.41), control2: pt(12.38, 5.23))
    p.addCurve(to: pt(13.12, 7.58), control1: pt(12.81, 5.99), control2: pt(13.12, 6.7))
    p.addCurve(to: pt(9.47, 11.53), control1: pt(13.12, 10.65), control2: pt(11.25, 11.33))
    p.addCurve(to: pt(10.01, 13.01), control1: pt(9.76, 11.78), control2: pt(10.01, 12.26))
    p.addCurve(to: pt(10, 15.21), control1: pt(10.01, 14.08), control2: pt(10, 14.94))
    p.addCurve(to: pt(10.55, 15.59), control1: pt(10, 15.42), control2: pt(10.15, 15.67))
    p.addCurve(to: pt(16, 8), control1: pt(13.805, 14.489), control2: pt(16, 11.436))
    p.addCurve(to: pt(8, 0), control1: pt(16, 3.58), control2: pt(12.42, 0))
    p.closeSubpath()
    return p
  }
}
