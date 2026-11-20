// Before the body paints: the home look when no race is in the URL (index.html loads it blocking, in place of an
// inline script, so the page can run under a Content-Security-Policy without 'unsafe-inline')
if (!location.hash) document.documentElement.classList.add('home');
