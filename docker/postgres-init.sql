-- Runs once when the postgres volume is first created.
-- A separate database keeps integration tests away from dev data.
CREATE DATABASE timekeep_test OWNER timekeep;
