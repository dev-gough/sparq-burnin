#!/bin/bash

# Setup script for burnin dashboard database

echo "Setting up burnin dashboard database..."

# Check if PostgreSQL is running as postgres user
if ! sudo -u postgres pg_isready -q; then
    echo "PostgreSQL is not running. Please start PostgreSQL first."
    exit 1
fi

# Create database if it doesn't exist as postgres user
echo "Creating database..."
sudo -u postgres createdb burnin_dashboard 2>/dev/null || echo "Database already exists"

# Run schema setup as postgres user, piping the SQL file
echo "Setting up database schema..."
cat scripts/setup-database.sql | sudo -u postgres psql -d burnin_dashboard

echo "Database setup complete!"
echo ""
echo "To ingest CSV files:"
echo "1. Place CSV files in data/to_process/results/ and data/to_process/tests/"
echo "2. Run: npm run ingest"
echo ""
echo "Make sure to copy .env.example to .env and update database credentials if needed."