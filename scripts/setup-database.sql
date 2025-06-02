-- Database setup script for the burnin dashboard
-- Run this script to create the database and tables

-- Create the database (run this as superuser)
-- CREATE DATABASE burnin_dashboard;

-- Connect to the database and run the schema
\c burnin_dashboard;

-- Drop tables if they exist (for re-runs)
DROP TABLE IF EXISTS TestData CASCADE;
DROP TABLE IF EXISTS Tests CASCADE;
DROP TABLE IF EXISTS Inverters CASCADE;

-- Create the Inverters table
CREATE TABLE Inverters (
    inv_id SERIAL PRIMARY KEY,
    serial_number VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create the Tests table
CREATE TABLE Tests (
    test_id SERIAL PRIMARY KEY,
    inv_id INTEGER NOT NULL REFERENCES Inverters(inv_id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    firmware_version VARCHAR(20),
    overall_status VARCHAR(10) NOT NULL,
    ac_status VARCHAR(10),
    ch1_status VARCHAR(10),
    ch2_status VARCHAR(10),
    ch3_status VARCHAR(10),
    ch4_status VARCHAR(10),
    status_flags TEXT,
    failure_description TEXT,
    source_file VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create the TestData table
CREATE TABLE TestData (
    data_id SERIAL PRIMARY KEY,
    test_id INTEGER NOT NULL REFERENCES Tests(test_id),
    timestamp TIMESTAMP NOT NULL,
    vgrid FLOAT,
    pgrid FLOAT,
    qgrid FLOAT,
    vpv1 FLOAT,
    ppv1 FLOAT,
    vpv2 FLOAT,
    ppv2 FLOAT,
    vpv3 FLOAT,
    ppv3 FLOAT,
    vpv4 FLOAT,
    ppv4 FLOAT,
    frequency FLOAT,
    vbus FLOAT,
    extstatus INTEGER,
    status INTEGER,
    temperature FLOAT,
    epv1 FLOAT,
    epv2 FLOAT,
    epv3 FLOAT,
    epv4 FLOAT,
    active_energy FLOAT,
    reactive_energy FLOAT,
    extstatus_latch INTEGER,
    status_latch INTEGER,
    vgrid_inst_latch FLOAT,
    vntrl_inst_latch FLOAT,
    igrid_inst_latch FLOAT,
    vbus_inst_latch FLOAT,
    vpv1_inst_latch FLOAT,
    ipv1_inst_latch FLOAT,
    vpv2_inst_latch FLOAT,
    ipv2_inst_latch FLOAT,
    vpv3_inst_latch FLOAT,
    ipv3_inst_latch FLOAT,
    vpv4_inst_latch FLOAT,
    ipv4_inst_latch FLOAT,
    status_bits TEXT,
    source_file VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX idx_inverters_serial ON Inverters(serial_number);
CREATE INDEX idx_tests_inv_id ON Tests(inv_id);
CREATE INDEX idx_tests_start_time ON Tests(start_time);
CREATE INDEX idx_testdata_test_id ON TestData(test_id);
CREATE INDEX idx_testdata_timestamp ON TestData(timestamp);

-- Create a view for joined data
CREATE VIEW test_summary AS
SELECT 
    i.serial_number,
    t.test_id,
    t.start_time,
    t.end_time,
    t.firmware_version,
    t.overall_status,
    t.failure_description,
    COUNT(td.data_id) as data_point_count
FROM Inverters i
JOIN Tests t ON i.inv_id = t.inv_id
LEFT JOIN TestData td ON t.test_id = td.test_id
GROUP BY i.serial_number, t.test_id, t.start_time, t.end_time, 
         t.firmware_version, t.overall_status, t.failure_description
ORDER BY t.start_time DESC;