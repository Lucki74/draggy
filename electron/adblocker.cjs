const adDomains = [
  "doubleclick.net", "googleadservices.com", "googlesyndication.com",
  "adsystem.com", "advertising.com", "adbrite.com", "adzerk.net",
  "criteo.com", "rubiconproject.com", "pubmatic.com", "openx.net",
  "taboola.com", "outbrain.com", "amazon-adsystem.com",
  "google-analytics.com", "scorecardresearch.com", "quantserve.com",
  "hotjar.com", "clarity.ms", "appsflyer.com", "mixpanel.com",
  "segment.com", "adroll.com", "bidswitch.net", "casalemedia.com",
  "crwdcntrl.net", "demdex.net", "dotomi.com", "emxdgt.com",
  "exelator.com", "ib.adnxs.com", "krxd.net", "mathtag.com",
  "moatads.com", "mookie1.com", "rlcdn.com", "smartadserver.com",
  "tapad.com", "teads.tv", "tribalfusion.com", "turn.com",
  "yieldoptimizer.com", "zedo.com", "adform.net", "adtech.de",
  "adtechus.com", "contextweb.com", "fastclick.net", "flashtalking.com",
  "indexexchange.com", "media.net", "revcontent.com", "sharethis.com",
  "statcounter.com", "viglink.com", "yieldmanager.com", "ads-twitter.com",
  "bingads.microsoft.com", "ad.doubleclick.net", "ads.linkedin.com"
];

const adPatterns = [
  "/ads?", "/ad/banner", "/tracking?", "/pixel?", "/analytics.js",
  "/gtm.js", "/fbds.js", "/fbevents.js", "/ad.js", "/advertisement",
  "ad_type=", "ad_slot="
];

function setupAdblocker(session) {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {

    if (!details.url.startsWith("http")) return callback({ cancel: false });

    const url = details.url.toLowerCase();
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      return callback({ cancel: false });
    }

    if (adDomains.some((domain) => url.includes(domain))) {
      return callback({ cancel: true });
    }
    if (adPatterns.some((pattern) => url.includes(pattern))) {
      return callback({ cancel: true });
    }

    callback({ cancel: false });
  });
}

function injectCosmeticFilters(webContents) {

  const css = `
    .ad, .ads, .advertisement, .ad-container, .ad-wrapper, .ad-banner,
    [id^="ad-"], [class^="ad-"], [class*=" ad-"], [class*="sponsored"], [id*="sponsored"],
    iframe[src*="ads"], iframe[src*="doubleclick"],
    .taboola, .outbrain, .OUTBRAIN, #outbrain_widget,
    .adsbygoogle, #google_image_div, #google_flash_div,
    .video-ads, .ytp-ad-module, .native-ad, .banner-ad
    {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      height: 0 !important;
      width: 0 !important;
      pointer-events: none !important;
    }
  `;
  webContents.insertCSS(css).catch((e) => console.error("Adblocker CSS injection failed", e));
}

module.exports = { setupAdblocker, injectCosmeticFilters };
