-- Registrations require admin approval before the player area unlocks.
-- Existing users are grandfathered in.
ALTER TABLE "user" ADD COLUMN "approved" INTEGER NOT NULL DEFAULT 0;
UPDATE "user" SET "approved" = 1;
