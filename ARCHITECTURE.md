# CalMobile Architecture

This document describes the technical architecture of the CalMobile Android application.

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Layer Architecture](#layer-architecture)
4. [Key Classes](#key-classes)
5. [Data Flow](#data-flow)
6. [Design Patterns](#design-patterns)
7. [Database Schema](#database-schema)
8. [UI Architecture](#ui-architecture)
9. [Testing Strategy](#testing-strategy)

## Overview

CalMobile follows a layered architecture pattern with clear separation of concerns:

- **Presentation Layer**: Activities and XML layouts
- **Business Logic Layer**: Manager classes
- **Data Layer**: Database helpers and models
- **Utility Layer**: Helper classes

The application uses Android SDK APIs exclusively, with no external dependencies except JUnit for testing.

## Project Structure

```
app/src/main/java/com/example/calmobile/
├── Activities/
│   ├── BaseActivity.java          # Base class with common UI helpers
│   ├── MainActivity.java          # Home screen with calendar
│   ├── LoginActivity.java         # Login screen
│   ├── RegisterActivity.java      # Registration screen
│   ├── ProfileActivity.java       # User profile and settings
│   ├── UserPublicActivity.java    # Public user profile
│   ├── ExhibitorBackendActivity.java  # Exhibitor management
│   ├── RegistrationManagementActivity.java  # Registration management
│   ├── AdminBackendActivity.java  # Admin panel
│   └── SearchActivity.java        # Search functionality
├── Managers/
│   ├── ExhibitionManager.java     # Exhibition CRUD operations
│   ├── RegistrationManager.java   # Registration CRUD operations
│   ├── AdminUserManager.java      # User management operations
│   └── AuthManager.java           # Authentication logic
├── Models/
│   ├── ExhibitorExhibition.java   # Exhibition data model
│   ├── Registration.java          # Registration data model
│   └── AdminUser.java             # User data model
├── Helpers/
│   ├── DatabaseHelper.java        # SQLite database singleton
│   ├── NotificationHelper.java    # Notification management
│   ├── CalendarHelper.java        # Calendar integration
│   ├── ExportManager.java         # CSV data export
│   └── RichTextViewer.java        # HTML text rendering
└── CalMobileApp.java              # Application class
```

## Layer Architecture

### Presentation Layer

**Responsibilities:**
- Display UI elements
- Handle user interactions
- Navigate between screens
- Display data from business logic layer

**Key Components:**
- Activities (UI screens)
- XML Layouts (UI structure)
- Animations (UI transitions)

**Communication:**
- Receives user input
- Calls Manager methods
- Observes data changes
- Updates UI accordingly

### Business Logic Layer

**Responsibilities:**
- Implement business rules
- Coordinate data operations
- Manage application state
- Handle data validation

**Key Components:**
- ExhibitionManager
- RegistrationManager
- AdminUserManager
- AuthManager

**Communication:**
- Receives calls from Activities
- Calls DatabaseHelper for data operations
- Returns results to Activities

### Data Layer

**Responsibilities:**
- Persist data
- Retrieve data
- Manage database schema
- Handle data migrations

**Key Components:**
- DatabaseHelper (SQLite)
- SharedPreferences (settings)
- In-memory storage (fallback)

**Communication:**
- Receives calls from Managers
- Performs CRUD operations
- Returns data to Managers

### Utility Layer

**Responsibilities:**
- Provide common functionality
- Handle system integrations
- Format and display data
- Export data

**Key Components:**
- NotificationHelper
- CalendarHelper
- ExportManager
- RichTextViewer

## Key Classes

### BaseActivity

**Location:** `app/src/main/java/com/example/calmobile/BaseActivity.java`

**Responsibilities:**
- Provide common UI helper methods
- Handle dimension conversions
- Create styled TextViews
- Manage card styling
- Handle panel animations
- Show empty states
- Display confirmation dialogs
- Manage navigation transitions

**Key Methods:**
- `dp(int value)`: Convert dp to pixels
- `fullWidthParams(int topMarginDp)`: Create layout parameters
- `addText(LinearLayout parent, String text, int colorRes, int sizeSp, int style)`: Create styled TextView
- `styleCard(LinearLayout card)`: Apply card styling
- `animateShowPanel(View panel)`: Animate panel in
- `animateHidePanel(View panel)`: Animate panel out
- `animateListItems(LinearLayout container, int startDelay)`: Animate list items
- `showEmptyState(LinearLayout container, String message)`: Show empty state
- `showConfirmDialog(String message, Runnable onConfirm)`: Show confirmation dialog
- `navigateTo(Class<? extends Activity> activityClass)`: Navigate to activity

### DatabaseHelper

**Location:** `app/src/main/java/com/example/calmobile/DatabaseHelper.java`

**Responsibilities:**
- Manage SQLite database
- Handle database creation and upgrades
- Provide CRUD operations for all tables
- Generate sequential IDs

**Key Methods:**
- `init(Context context)`: Initialize singleton
- `getInstance()`: Get singleton instance
- `insertExhibition(...)`: Insert exhibition
- `updateExhibition(...)`: Update exhibition
- `deleteExhibition(String id)`: Delete exhibition
- `getAllExhibitions()`: Get all exhibitions
- `getExhibitionById(String id)`: Get exhibition by ID
- `searchExhibitions(String query)`: Search exhibitions
- `insertRegistration(...)`: Insert registration
- `updateRegistrationStatus(...)`: Update registration status
- `getAllRegistrations()`: Get all registrations
- `insertUser(...)`: Insert user
- `updateUserStatus(...)`: Update user status
- `getAllUsers()`: Get all users
- `searchUsers(String query)`: Search users

### ExhibitionManager

**Location:** `app/src/main/java/com/example/calmobile/ExhibitionManager.java`

**Responsibilities:**
- Manage exhibition business logic
- Coordinate with DatabaseHelper
- Provide fallback to in-memory storage
- Seed sample data

**Key Methods:**
- `ensureInitialized()`: Initialize with sample data
- `add(...)`: Add exhibition
- `update(...)`: Update exhibition
- `delete(String id)`: Delete exhibition
- `updateStatus(String id, String newStatus)`: Update status
- `listAll()`: List all exhibitions
- `findById(String id)`: Find by ID
- `search(String query)`: Search exhibitions
- `getRegistrationRecords(ExhibitorExhibition exhibition)`: Get registration records

### RegistrationManager

**Location:** `app/src/main/java/com/example/calmobile/RegistrationManager.java`

**Responsibilities:**
- Manage registration business logic
- Coordinate with DatabaseHelper
- Provide fallback to in-memory storage

**Key Methods:**
- `submit(...)`: Submit registration
- `list()`: List all registrations
- `cancel(String id)`: Cancel registration

### AuthManager

**Location:** `app/src/main/java/com/example/calmobile/AuthManager.java`

**Responsibilities:**
- Handle user authentication
- Manage user sessions
- Validate credentials

**Key Methods:**
- `getInstance()`: Get singleton instance
- `register(String username, String password, String email)`: Register user
- `login(String username, String password)`: Login user
- `logout()`: Logout user
- `isLoggedIn()`: Check if logged in
- `getCurrentUsername()`: Get current username
- `getCurrentUserEmail()`: Get current user email
- `getUserCount()`: Get user count

### NotificationHelper

**Location:** `app/src/main/java/com/example/calmobile/NotificationHelper.java`

**Responsibilities:**
- Manage notification channels
- Send notifications
- Handle notification permissions
- Store notification settings

**Key Methods:**
- `getInstance(Context context)`: Get singleton instance
- `createNotificationChannels()`: Create notification channels
- `hasNotificationPermission()`: Check notification permission
- `requestNotificationPermission(Activity activity)`: Request permission
- `sendExhibitionReminder(...)`: Send exhibition reminder
- `sendRegistrationStatusNotification(...)`: Send registration status notification
- `sendRegistrationConfirmation(...)`: Send registration confirmation
- `isExhibitionReminderEnabled()`: Check if reminders enabled
- `setExhibitionReminderEnabled(boolean enabled)`: Enable/disable reminders
- `isRegistrationUpdatesEnabled()`: Check if updates enabled
- `setRegistrationUpdatesEnabled(boolean enabled)`: Enable/disable updates
- `getHistory()`: Get notification history
- `clearHistory()`: Clear notification history

### CalendarHelper

**Location:** `app/src/main/java/com/example/calmobile/CalendarHelper.java`

**Responsibilities:**
- Manage calendar integration
- Add/remove calendar events
- Handle calendar permissions
- Track calendar event mappings

**Key Methods:**
- `hasCalendarPermissions(Context context)`: Check calendar permissions
- `requestCalendarPermissions(Activity activity)`: Request permissions
- `addToCalendar(...)`: Add exhibition to calendar
- `isInCalendar(Context context, String title, int day)`: Check if in calendar
- `removeFromCalendar(...)`: Remove from calendar
- `parseTimeRange(int day, String time)`: Parse time range

### ExportManager

**Location:** `app/src/main/java/com/example/calmobile/ExportManager.java`

**Responsibilities:**
- Export data to CSV
- Handle file writing
- Format CSV data

**Key Methods:**
- `exportExhibitions(Context context)`: Export exhibitions
- `exportRegistrations(Context context)`: Export registrations
- `exportUsers(Context context)`: Export users
- `escapeCsv(String field)`: Escape CSV field

### RichTextViewer

**Location:** `app/src/main/java/com/example/calmobile/RichTextViewer.java`

**Responsibilities:**
- Parse HTML tags
- Apply text styling
- Handle links
- Render rich text

**Key Methods:**
- `setText(TextView textView, String text, Context context)`: Set rich text
- `containsHtml(String text)`: Check if contains HTML
- `parseHtml(String text, Context context)`: Parse HTML
- `extractAttr(String tag, String attrName)`: Extract attribute

## Data Flow

### Exhibition Browsing Flow

```
User → MainActivity → ExhibitionManager → DatabaseHelper → SQLite
                ↓
        MainActivity.updateUI()
```

1. User opens app
2. MainActivity calls ExhibitionManager.listAll()
3. ExhibitionManager calls DatabaseHelper.getAllExhibitions()
4. DatabaseHelper queries SQLite database
5. Data returns through the chain
6. MainActivity updates UI

### Registration Flow

```
User → MainActivity → RegistrationManager → DatabaseHelper → SQLite
                ↓
        MainActivity.updateUI()
                ↓
        NotificationHelper.sendRegistrationConfirmation()
```

1. User fills registration form
2. MainActivity calls RegistrationManager.submit()
3. RegistrationManager calls DatabaseHelper.insertRegistration()
4. DatabaseHelper inserts into SQLite
5. Registration returns through the chain
6. MainActivity updates UI
7. NotificationHelper sends confirmation

### Authentication Flow

```
User → LoginActivity → AuthManager → In-Memory Storage
                ↓
        LoginActivity.navigateToMain()
```

1. User enters credentials
2. LoginActivity calls AuthManager.login()
3. AuthManager validates credentials
4. AuthManager updates session
5. LoginActivity navigates to MainActivity

## Design Patterns

### Singleton Pattern

Used for:
- DatabaseHelper
- AuthManager
- NotificationHelper

**Implementation:**
```java
private static DatabaseHelper instance;

public static synchronized DatabaseHelper getInstance() {
    return instance;
}

public static synchronized void init(Context context) {
    if (instance == null) {
        instance = new DatabaseHelper(context.getApplicationContext());
    }
}
```

### Manager Pattern

Used for:
- ExhibitionManager
- RegistrationManager
- AdminUserManager

**Implementation:**
```java
public class ExhibitionManager {
    public static List<ExhibitorExhibition> listAll() {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getAllExhibitions();
        }
        return new ArrayList<>(fallbackExhibitions);
    }
}
```

### Dual Storage Pattern

All managers support both SQLite and in-memory storage:

```java
public static List<ExhibitorExhibition> listAll() {
    DatabaseHelper dbHelper = DatabaseHelper.getInstance();
    if (dbHelper != null) {
        return dbHelper.getAllExhibitions();
    }
    return new ArrayList<>(fallbackExhibitions);
}
```

### Template Method Pattern

BaseActivity provides template methods for common UI operations:

```java
public abstract class BaseActivity extends Activity {
    protected int dp(int value) { ... }
    protected LinearLayout.LayoutParams fullWidthParams(int topMarginDp) { ... }
    protected TextView addText(LinearLayout parent, String text, int colorRes, int sizeSp, int style) { ... }
    protected void styleCard(LinearLayout card) { ... }
    protected void animateShowPanel(View panel) { ... }
    protected void animateHidePanel(View panel) { ... }
    protected void animateListItems(LinearLayout container, int startDelay) { ... }
    protected void showEmptyState(LinearLayout container, String message) { ... }
    protected void showConfirmDialog(String message, Runnable onConfirm) { ... }
    protected void navigateTo(Class<? extends Activity> activityClass) { ... }
}
```

## Database Schema

### Exhibitions Table

```sql
CREATE TABLE exhibitions (
    _id TEXT PRIMARY KEY,
    day INTEGER NOT NULL,
    title TEXT NOT NULL,
    venue TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT ''
);
```

### Registrations Table

```sql
CREATE TABLE registrations (
    _id TEXT PRIMARY KEY,
    exhibition_title TEXT NOT NULL,
    exhibition_day INTEGER NOT NULL,
    exhibition_time TEXT NOT NULL,
    exhibition_venue TEXT NOT NULL,
    visitor_name TEXT NOT NULL,
    visitor_type TEXT NOT NULL,
    needs_summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL
);
```

### Users Table

```sql
CREATE TABLE users (
    _id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    registration_time TEXT NOT NULL DEFAULT '',
    last_login_time TEXT NOT NULL DEFAULT ''
);
```

## UI Architecture

### Activity Lifecycle

All Activities follow standard Android lifecycle:
1. onCreate() - Initialize UI
2. onStart() - Activity becomes visible
3. onResume() - Activity becomes interactive
4. onPause() - Activity loses focus
5. onStop() - Activity becomes invisible
6. onDestroy() - Activity is destroyed

### Navigation

Navigation uses explicit Intents with slide animations:

```java
protected void navigateTo(Class<? extends Activity> activityClass) {
    startActivity(new Intent(this, activityClass));
    overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
}
```

### UI Components

- **LinearLayout**: Primary container for vertical/horizontal layouts
- **GridLayout**: Calendar grid display
- **TextView**: Text display
- **Button**: User interactions
- **EditText**: Text input
- **RadioGroup/RadioButton**: Single selection
- **CheckBox**: Multiple selection
- **ScrollView**: Scrollable content

### Animations

Located in `app/src/main/res/anim/`:
- `fade_in.xml`: Fade in animation
- `fade_out.xml`: Fade out animation
- `slide_in_left.xml`: Slide in from left
- `slide_in_right.xml`: Slide in from right
- `slide_out_left.xml`: Slide out to left
- `slide_out_right.xml`: Slide out to right

## Testing Strategy

### Unit Tests

Located in `app/src/test/java/com/example/calmobile/`:

- **AuthManagerTest**: Authentication logic
- **DatabaseHelperTest**: Database operations
- **ExhibitionManagerTest**: Exhibition management
- **RegistrationManagerTest**: Registration management
- **AdminUserManagerTest**: User management
- **ExportManagerTest**: Data export
- **NotificationHelperTest**: Notifications
- **CalendarHelperTest**: Calendar integration
- **RichTextViewerTest**: Rich text rendering
- **ExhibitorExhibitionTest**: Exhibition model
- **AdminUserTest**: User model

### Integration Tests

- **ExhibitionWorkflowIntegrationTest**: Complete exhibition workflow
- **RegistrationWorkflowIntegrationTest**: Complete registration workflow
- **SearchWorkflowIntegrationTest**: Search functionality
- **UserManagementWorkflowIntegrationTest**: User management workflow

### Smoke Test

Located in `scripts/smoke-check.js`:
- Verifies project structure
- Checks required files exist
- Validates file contents
- Ensures documentation is complete

## Performance Considerations

### Database Optimization

- Indexed columns for frequent queries
- Prepared statements for repeated operations
- Connection pooling via singleton pattern

### UI Optimization

- View recycling in lists
- Lazy loading for large datasets
- Animation optimization with hardware acceleration

### Memory Management

- Singleton pattern for heavy objects
- Proper Activity lifecycle handling
- Bitmap recycling for images

## Security Considerations

### Data Storage

- SQLite database stored in app-private storage
- SharedPreferences for sensitive settings
- No external storage for sensitive data

### Authentication

- In-memory session management
- Password validation on client side
- No sensitive data in logs

### Permissions

- Runtime permission requests
- Graceful degradation when permissions denied
- Clear permission explanations

## Future Considerations

### Network Layer

- API integration for remote data
- Offline-first architecture
- Data synchronization

### Media Upload

- Image/video compression
- Progress tracking
- Error handling

### Push Notifications

- Firebase Cloud Messaging
- Notification channels
- Background processing

## Conclusion

CalMobile follows a clean, layered architecture with clear separation of concerns. The use of Android SDK APIs exclusively ensures minimal dependencies and full control over the codebase. The dual storage pattern (SQLite + in-memory) provides flexibility for testing and future enhancements.
