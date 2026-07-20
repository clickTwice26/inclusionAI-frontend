/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the dev server's internal /_next/* resources (JS chunks, HMR socket)
  // to be requested when the app is opened by LAN IP from another device.
  // Without this, Next.js 16 blocks them and the page never hydrates.
  // Wildcards match one segment each (Next's isCsrfOriginAllowed), so these
  // cover any private-LAN IP and survive the router handing out a new address.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
};

module.exports = nextConfig;
