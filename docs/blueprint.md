# **App Name**: Traccar Web Client

## Core Features:

- Configuration UI: Provides a user interface with fields for device ID, Traccar server URL, and tracking interval configuration.
- GPS Data Transmission: Obtains GPS data from the browser's navigator.geolocation API and sends it to the Traccar server at configured intervals using HTTP requests with parameters such as id, lat, lon, timestamp, speed, altitude, accuracy, and bearing.
- Status and Error Display: Displays the current status of the application (e.g., 'Sending location...' or 'Stopped') and any GPS or sending errors.

## Style Guidelines:

- Responsive layout using TailwindCSS to adapt to different screen sizes.
- Neutral background color (e.g., #f3f4f6) for a clean look.
- Primary color: Blue (#3b82f6) for interactive elements (buttons, links).
- Accent: Teal (#14b8a6) for status indicators and highlights.
- Clear and readable text using a sans-serif font.
- Simple and recognizable icons for start/stop tracking and error messages.