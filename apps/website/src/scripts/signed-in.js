if (/(?:^|;\s*)signed_in=1(?:;|$)/.test(document.cookie)) {
  document.documentElement.setAttribute('data-signed-in', '');
}
