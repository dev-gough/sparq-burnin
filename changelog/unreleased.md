Unreleased

Fixed
- Allow manual production deployment on servers using .env.production and other standard production environment files, preserving health-token file precedence.
- Attach shared configuration, data, and log symlinks after staged production builds so Turbopack does not follow log links outside the release directory.
