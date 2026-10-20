-- Guest accounts created per IP (salted hash, kept one day): caps throwaway guests farming the start grant.
CREATE TABLE guest_ips (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX guest_ips_hash ON guest_ips(ip_hash, created_at);
