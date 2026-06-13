# CalMobile

An Android mobile application for exhibition scheduling, registration, and management.

## Overview

CalMobile is a native Android application built with Java that provides a complete exhibition management solution. It supports exhibition browsing, visitor registration, exhibitor backend management, and admin controls.

## Features

### Core Features
- **Exhibition Calendar**: Monthly view showing exhibitions with day markers
- **Exhibition Details**: Rich exhibition information with status indicators
- **Registration System**: Visitor registration with customizable form fields
- **My Registrations**: View and manage personal registration records

### User Features
- **User Profiles**: Personal profile with bio, contact info, and social media
- **Public Profiles**: View other users' public profiles
- **Registration History**: Track exhibition attendance history

### Exhibitor Features
- **Exhibitor Backend**: Create, edit, and delete exhibitions
- **Registration Management**: Review and approve/reject visitor registrations
- **Exhibition Status Control**: Manage exhibition status (open, closed, ended)

### Admin Features
- **User Management**: View, ban, restrict, and manage user accounts
- **Exhibition Management**: Oversee all exhibitions with lock/unlock capabilities
- **Data Export**: Export exhibitions, registrations, and users to CSV

### Enhanced Features
- **SQLite Database**: Local persistent storage for all data
- **Authentication System**: User registration and login
- **Rich Text Viewer**: HTML rendering for exhibition descriptions
- **Search Functionality**: Search exhibitions and users
- **Notification System**: Exhibition reminders and registration updates
- **Calendar Integration**: Add exhibitions to device calendar
- **UI Animations**: Smooth transitions and list animations

## Screenshots

*Coming soon*

## Architecture

For detailed architecture information, see [ARCHITECTURE.md](ARCHITECTURE.md).

### Project Structure

```
calMobile/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/example/calmobile/
│   │   │   │   ├── Activities (UI layer)
│   │   │   │   ├── Managers (Business logic)
│   │   │   │   ├── Models (Data models)
│   │   │   │   └── Helpers (Utilities)
│   │   │   ├── res/
│   │   │   │   ├── layout/ (XML layouts)
│   │   │   │   ├── values/ (Strings, colors, themes)
│   │   │   │   ├── anim/ (Animations)
│   │   │   │   └── drawable/ (Drawables)
│   │   │   └── AndroidManifest.xml
│   │   └── test/
│   │       └── java/com/example/calmobile/
│   │           ├── Unit tests
│   │           └── Integration tests
│   └── build.gradle
├── build.gradle
├── settings.gradle
├── gradle/
├── scripts/
│   └── smoke-check.js
├── docs/
│   └── MOBILE_REQUIREMENTS.md
├── AGENT.md
├── ARCHITECTURE.md
├── TODO.md
└── MOBILE_REQUIREMENTS.md
```

## Prerequisites

- Android Studio Arctic Fox or later
- JDK 8 or later
- Android SDK with API 30 installed
- Gradle 7.6.4 (included via wrapper)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/Blathroat/calMobile.git
cd calMobile
```

### 2. Open in Android Studio

1. Launch Android Studio
2. Select "Open an existing project"
3. Navigate to the cloned directory and click "OK"
4. Wait for Gradle sync to complete

### 3. Configure SDK

1. Go to File → Project Structure → SDK Location
2. Ensure Android SDK location is set correctly
3. Verify API 30 is installed in SDK Manager

## Build Instructions

### Using Android Studio

1. Select Build → Make Project (or press Ctrl+F9)
2. Wait for build to complete
3. Check Build Output for any errors

### Using Command Line

```bash
# Windows
gradlew.bat :app:assembleDebug

# Linux/Mac
./gradlew :app:assembleDebug
```

### Build Variants

- **debug**: Development build with debug symbols
- **release**: Production build (requires signing configuration)

## Running the App

### On Emulator

1. Create an AVD (Android Virtual Device) in Device Manager
2. Select a device with API 30 or higher
3. Click Run → Run 'app' (or press Shift+F10)
4. Select the emulator and click OK

### On Physical Device

1. Enable Developer Options on your device
2. Enable USB Debugging
3. Connect device via USB
4. Click Run → Run 'app' (or press Shift+F10)
5. Select your device and click OK

## Testing

### Running Unit Tests

```bash
# Windows
gradlew.bat :app:testDebugUnitTest

# Linux/Mac
./gradlew :app:testDebugUnitTest
```

### Test Coverage

The project includes 15 test files covering:

- **Unit Tests**:
  - AuthManagerTest
  - DatabaseHelperTest
  - ExhibitionManagerTest
  - RegistrationManagerTest
  - AdminUserManagerTest
  - ExportManagerTest
  - NotificationHelperTest
  - CalendarHelperTest
  - RichTextViewerTest
  - ExhibitorExhibitionTest
  - AdminUserTest

- **Integration Tests**:
  - ExhibitionWorkflowIntegrationTest
  - RegistrationWorkflowIntegrationTest
  - SearchWorkflowIntegrationTest
  - UserManagementWorkflowIntegrationTest

### Smoke Test

Run the smoke test to verify project structure:

```bash
node scripts/smoke-check.js
```

## Project Status

### Current Phase
Feature complete, focusing on optimization and enhancement.

### Implemented Features
- Exhibition calendar with monthly view (4.1)
- Exhibition details display (4.2)
- Registration form submission (4.3)
- My registrations list with cancel functionality (4.4)
- Personal profile and account settings (4.5)
- User public profiles (4.6)
- Exhibitor backend (4.7)
- Registration management (4.8)
- Admin backend (4.9)

### Completed Enhancements
- SQLite local persistence
- Local authentication system
- Rich text viewer
- Search functionality
- Data export (CSV)
- Notification system
- Calendar integration
- UI animations and styling
- Unit test coverage

### Pending Features
- Network layer (API integration)
- Media upload
- Push notifications

## Contributing

### Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Run tests to ensure nothing is broken
4. Commit with descriptive message
5. Push and create a Pull Request

### Code Style

- Follow Java naming conventions
- Use meaningful variable and method names
- Add Javadoc comments for public methods
- Keep methods focused and small

### Commit Messages

Use conventional commit format:
- `feat: add new feature`
- `fix: fix bug`
- `docs: update documentation`
- `test: add tests`
- `refactor: refactor code`

## Dependencies

### Current Dependencies

- **JUnit 4.13.2**: Unit testing (testImplementation only)

### No External Dependencies

The project intentionally uses only Android SDK APIs to:
- Minimize APK size
- Reduce dependency conflicts
- Maintain full control over the codebase

## Permissions

The app requests the following permissions:

- `POST_NOTIFICATIONS`: For exhibition reminders (API 33+)
- `READ_CALENDAR`: For calendar integration
- `WRITE_CALENDAR`: For calendar integration

## Known Issues

- Authentication is currently in-memory (will be integrated with SQLite)
- Sample data is hardcoded (will be replaced with API data)
- Rich text editor not yet implemented (viewer only)

## License

This project is private and not licensed for public use.

## Contact

For questions or support, please contact the project maintainer.

## Acknowledgments

- Original requirements from TODO.md
- Mobile requirements adapted from docs/MOBILE_REQUIREMENTS.md
- Built with Android SDK and Gradle
