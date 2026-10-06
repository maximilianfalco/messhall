import AppKit
import Feed
import SwiftUI

/// The Settings window (cmd comma): appearance, avatar colors and notifications, all kept in `AppSettings`.
struct SettingsView: View {
  let store: FeedStore
  @Bindable var settings: AppSettings

  var body: some View {
    TabView(selection: $settings.snapshot.pane) {
      AppearancePane(settings: settings)
        .tabItem { Label("Appearance", systemImage: "paintpalette") }
        .tag(SettingsPane.appearance)
      AvatarsPane(store: store, settings: settings)
        .tabItem { Label("Avatars", systemImage: "person.crop.circle") }
        .tag(SettingsPane.avatars)
      NotificationsPane(store: store, settings: settings)
        .tabItem { Label("Notifications", systemImage: "bell.badge") }
        .tag(SettingsPane.notifications)
    }
    .frame(width: 460)
    .accentFromSettings()
  }
}

extension AppearanceChoice {
  var title: String {
    switch self {
    case .system: "System"
    case .light: "Light"
    case .dark: "Dark"
    }
  }

  /// Nil hands the choice back to the system.
  @MainActor func apply() {
    switch self {
    case .system: NSApp.appearance = nil
    case .light: NSApp.appearance = NSAppearance(named: .aqua)
    case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
    }
  }
}

extension View {
  /// Tints controls with the accent picked in Settings, or leaves the system one.
  func accentFromSettings() -> some View { modifier(AccentTint()) }
}

private struct AccentTint: ViewModifier {
  func body(content: Content) -> some View {
    content.tint(AppSettings.shared.snapshot.accent.color)
  }
}

private struct AppearancePane: View {
  @Bindable var settings: AppSettings

  private var appearance: Binding<AppearanceChoice> {
    Binding(
      get: { settings.snapshot.appearance },
      set: {
        settings.snapshot.appearance = $0
        $0.apply()
      })
  }

  var body: some View {
    Form {
      Picker("Appearance", selection: appearance) {
        ForEach(AppearanceChoice.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .pickerStyle(.segmented)
      LabeledContent("Accent color") {
        HStack(spacing: 8) {
          ForEach(AccentChoice.allCases, id: \.self) { choice in
            AccentSwatch(choice: choice, selected: settings.snapshot.accent == choice) {
              settings.snapshot.accent = choice
            }
          }
        }
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
    .frame(height: 150)
  }
}

private struct AccentSwatch: View {
  let choice: AccentChoice
  let selected: Bool
  let pick: () -> Void

  private var name: String { choice == .system ? "System" : choice.rawValue.capitalized }

  var body: some View {
    Button(action: pick) {
      Circle()
        .fill(choice.color.map(AnyShapeStyle.init) ?? AnyShapeStyle(systemFill))
        .frame(width: 16, height: 16)
        .overlay { Circle().strokeBorder(.primary.opacity(0.15), lineWidth: 0.5) }
        .overlay {
          if selected { Circle().fill(.white).frame(width: 6, height: 6) }
        }
        .frame(width: 20, height: 20)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .help(name)
    .accessibilityLabel(name)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private var systemFill: AngularGradient {
    AngularGradient(colors: [.red, .orange, .yellow, .green, .blue, .purple, .pink, .red], center: .center)
  }
}

private struct AvatarsPane: View {
  let store: FeedStore
  @Bindable var settings: AppSettings

  private var names: [String] {
    let seen = store.rooms.flatMap(\.members).filter { $0.kind != .human }.map(\.name)
    return Set(seen).union(settings.snapshot.avatars.colors.keys).sorted()
  }

  var body: some View {
    Form {
      Section {
        if names.isEmpty {
          Text("Agents show here once they join a room.")
            .foregroundStyle(.secondary)
        }
        ForEach(names, id: \.self) { name in
          AvatarRow(name: name, settings: settings)
        }
      } footer: {
        HStack {
          Text("Pick a color to replace the one from the name.")
            .foregroundStyle(.secondary)
          Spacer()
          Button("Reset All") { settings.snapshot.avatars.resetAll() }
            .disabled(settings.snapshot.avatars.colors.isEmpty)
        }
      }
    }
    .formStyle(.grouped)
    .frame(height: 360)
  }
}

private struct AvatarRow: View {
  let name: String
  @Bindable var settings: AppSettings

  private var color: Binding<Color> {
    Binding(
      get: { avatarColor(for: name, in: settings) },
      set: { picked in
        guard let rgb = NSColor(picked).usingColorSpace(.sRGB) else { return }
        settings.snapshot.avatars.set(
          RGB(red: rgb.redComponent, green: rgb.greenComponent, blue: rgb.blueComponent), for: name)
      })
  }

  var body: some View {
    HStack(spacing: 10) {
      AvatarView(name: name, size: 22)
      Text(name)
      Spacer()
      ColorPicker("Color for \(name)", selection: color, supportsOpacity: false)
        .labelsHidden()
      Button("Reset") { settings.snapshot.avatars.reset(name) }
        .disabled(settings.snapshot.avatars.color(for: name) == nil)
        .help("Go back to the color from the name")
    }
  }
}

private struct NotificationsPane: View {
  let store: FeedStore
  @Bindable var settings: AppSettings

  private var rooms: [String] {
    Set(store.rooms.map(\.name)).union(settings.snapshot.mutedRooms).sorted()
  }

  private func notifies(_ room: String) -> Binding<Bool> {
    Binding(
      get: { !settings.snapshot.mutedRooms.contains(room) },
      set: { _ in settings.snapshot.toggleMute(room) })
  }

  var body: some View {
    Form {
      Section {
        Toggle("Show notifications", isOn: $settings.snapshot.notificationsEnabled)
      } footer: {
        Text("Banners for mentions of you or @all, a question from the only agent in a room, a closed room and the cap warning.")
          .foregroundStyle(.secondary)
      }
      Section {
        if rooms.isEmpty {
          Text("Rooms show here once one opens.")
            .foregroundStyle(.secondary)
        }
        ForEach(rooms, id: \.self) { room in
          Toggle("#\(room)", isOn: notifies(room))
        }
      } header: {
        Text("Rooms")
      } footer: {
        Text("The bell in a room's header does the same.")
          .foregroundStyle(.secondary)
      }
      .disabled(!settings.snapshot.notificationsEnabled)
    }
    .formStyle(.grouped)
    .frame(height: 360)
  }
}
