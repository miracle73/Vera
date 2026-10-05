ALTER TABLE guest_sessions ADD COLUMN IF NOT EXISTS owner_token VARCHAR(64) REFERENCES guest_sessions(token);
UPDATE guest_sessions v SET owner_token = g.token FROM guest_sessions g WHERE g.voice_token = v.token AND v.owner_token IS NULL;
CREATE TABLE IF NOT EXISTS guest_orders (guest_token VARCHAR(64) NOT NULL REFERENCES guest_sessions(token), order_id UUID NOT NULL REFERENCES orders(id), PRIMARY KEY (guest_token, order_id));
INSERT INTO guest_orders SELECT COALESCE(g.owner_token,g.token),o.id FROM guest_sessions g JOIN calls c ON c.vapi_call_id = g.call_id JOIN orders o ON o.call_id = c.id ON CONFLICT DO NOTHING;
