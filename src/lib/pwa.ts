/**
 * PWA Dynamic Scoping Helpers
 */

export function scopeInstallToStartUrl(startUrl: string, name: string) {
  try {
    const baseManifest = {
      id: startUrl,
      name: name,
      short_name: name.split(" ")[0] || "Nokael",
      description: "Nokael chain-of-custody driver app — jobs, status, and confirmations.",
      start_url: startUrl,
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#f2f4f7",
      theme_color: "#0f172a",
      icons: [
        {
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any"
        },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any"
        },
        {
          src: "/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable"
        }
      ]
    };

    // Serialize and create a Blob URL
    const blob = new Blob([JSON.stringify(baseManifest, null, 2)], {
      type: "application/json",
    });
    const manifestUrl = URL.createObjectURL(blob);

    // Find existing manifest link or create one
    let manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement("link");
      manifestLink.setAttribute("rel", "manifest");
      document.head.appendChild(manifestLink);
    }
    manifestLink.setAttribute("href", manifestUrl);

    console.log(`[PWA] Dynamically scoped install to: ${startUrl} (${name})`);
  } catch (error) {
    console.error("[PWA] Failed to scope manifest startUrl dynamically:", error);
  }
}
