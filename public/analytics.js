// アクセス計測のみ。CSVや画面の入力値を送信しない。
(function () {
  var allowed = location.hostname === 'invoice-transition-impact.takatrp0222.chatgpt.site'
    || (location.hostname === 'takatrp.github.io' && location.pathname.startsWith('/invoice-transition-impact/'));
  if (!allowed || window.invoiceAnalyticsInitialized) return;
  window.invoiceAnalyticsInitialized = true;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', 'G-FEEZS56P99', {
    page_location: location.origin + location.pathname,
    page_referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : '',
    page_title: 'インボイス経過措置 影響シミュレーター',
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });
  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-FEEZS56P99';
  document.head.appendChild(script);
})();
