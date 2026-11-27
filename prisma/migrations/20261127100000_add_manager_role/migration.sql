-- Add MANAGER role for Head of Sales (Fodé) between COMMERCIAL and ADMIN.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER';
