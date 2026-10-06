(function () {
  'use strict';

  // ひらがな・カタカナ・全角半角の違いを吸収して比べる
  function norm(s) {
    return String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0x60);
      });
  }

  // ---- トップページ: 入力した夢から辞典を探す ----
  var input = document.getElementById('dream-input');
  var button = document.getElementById('dream-search');
  var results = document.getElementById('dream-results');
  var data = window.YUME_DREAMS || [];

  function search(text) {
    var t = norm(text);
    if (!t.trim()) return [];
    var hits = [];
    data.forEach(function (d) {
      var score = 0;
      d.keywords.forEach(function (k) {
        var nk = norm(k);
        if (nk && t.indexOf(nk) !== -1) score += nk.length;
      });
      if (score > 0) {
        // 項目が見つかったときだけ、近い場面（場面別の詳しい意味）も探す
        var sits = (d.situations || []).filter(function (s) {
          return s.keywords.some(function (k) {
            var nk = norm(k);
            return nk && t.indexOf(nk) !== -1;
          });
        });
        hits.push({ d: d, score: score, sits: sits.slice(0, 3) });
      }
    });
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, 5);
  }

  function card(hit) {
    var d = hit.d;
    var wrap = document.createElement('div');
    wrap.className = 'result';

    var a = document.createElement('a');
    a.className = 'dream-card';
    a.href = d.url;
    var t = document.createElement('span');
    t.className = 't';
    t.textContent = d.title;
    var s = document.createElement('span');
    s.className = 's';
    s.textContent = d.summary;
    a.appendChild(t);
    a.appendChild(s);
    wrap.appendChild(a);

    if (hit.sits.length) {
      var row = document.createElement('div');
      row.className = 'sit-links';
      var label = document.createElement('span');
      label.className = 'sit-label';
      label.textContent = '近い場面';
      row.appendChild(label);
      hit.sits.forEach(function (st) {
        var l = document.createElement('a');
        l.href = d.url + '#' + st.id;
        l.textContent = st.title;
        row.appendChild(l);
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  function message(text) {
    var p = document.createElement('p');
    p.className = 'msg';
    p.textContent = text;
    return p;
  }

  if (input && button && results) {
    button.addEventListener('click', function () {
      results.textContent = '';
      if (!input.value.trim()) {
        results.appendChild(message('見た夢を、ひとこと入力してみてください。'));
        return;
      }
      var hits = search(input.value);
      if (hits.length === 0) {
        results.appendChild(
          message('この夢はまだ辞典にありません。近いテーマを、下の一覧から探してみてください。夢辞典は順次ふやしていきます。')
        );
        return;
      }
      results.appendChild(message('「' + hits.length + '件」見つかりました。'));
      hits.forEach(function (h) { results.appendChild(card(h)); });
    });
  }


  // ---- 場面別の詳しい意味: 合言葉で開く ----
  var lockedList = document.querySelector('[data-locked]');
  var unlockForm = document.querySelector('[data-unlock]');
  var STORE_KEY = 'yume-passes';

  function b64(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // 合言葉で「包まれた鍵」を開け、その鍵で本文を開く。包みは2つ(この項目の合言葉用、全部の項目の合言葉用)。
  function decryptBodies(pass) {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('unsupported'));
    var enc = new TextEncoder();
    var wraps = JSON.parse(lockedList.dataset.wraps);
    return subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      function tryWrap(i) {
        if (i >= wraps.length) return Promise.reject(new Error('bad'));
        var w = wraps[i];
        return subtle
          .deriveKey(
            { name: 'PBKDF2', salt: b64(w.salt), iterations: 200000, hash: 'SHA-256' },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
          )
          .then(function (kek) { return subtle.decrypt({ name: 'AES-GCM', iv: b64(w.iv) }, kek, b64(w.ct)); })
          .catch(function () { return tryWrap(i + 1); });
      }
      return tryWrap(0);
    })
      .then(function (raw) { return subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); })
      .then(function (dek) { return subtle.decrypt({ name: 'AES-GCM', iv: b64(lockedList.dataset.iv) }, dek, b64(lockedList.dataset.ct)); })
      .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }

  function showBodies(bodies) {
    var items = lockedList.querySelectorAll('.situation');
    items.forEach(function (el, i) {
      var p = el.querySelector('p');
      if (p && bodies[i] != null) {
        p.textContent = bodies[i];
        p.className = '';
      }
      el.classList.remove('locked');
    });
    if (unlockForm) unlockForm.hidden = true;
    document.querySelectorAll('.paywall-cta').forEach(function (el) { el.hidden = true; });
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  // 一度入力した合言葉は、このブラウザの中にだけ残し、他の夢のページでも順に試す
  function savedPasses() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; }
  }
  function rememberPass(pass) {
    var list = savedPasses().filter(function (x) { return x !== pass; });
    list.push(pass);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-20))); } catch (e) {}
  }

  function tryUnlock(pass) {
    var msg = unlockForm ? unlockForm.querySelector('.unlock-msg') : null;
    if (msg) msg.textContent = '確認しています…';
    return decryptBodies(pass).then(
      function (bodies) {
        showBodies(bodies);
        rememberPass(pass);
      },
      function (err) {
        if (msg) msg.textContent = err && err.message === 'unsupported'
          ? 'お使いのブラウザでは開けません。別のブラウザでお試しください。'
          : '合言葉が違うようです。この夢のページ用の合言葉をご確認ください。';
      }
    );
  }

  if (lockedList) {
    if (unlockForm) {
      unlockForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = unlockForm.querySelector('input').value.trim();
        if (v) tryUnlock(v);
      });
    }
    // 保存してある合言葉を、開くまで順に試す(静かに)
    (function trySaved(list, i) {
      if (i < 0) return;
      decryptBodies(list[i]).then(showBodies, function () { trySaved(list, i - 1); });
    })(savedPasses(), savedPasses().length - 1);
  }

  // ---- 共有ボタン: 開いているページのアドレスを使う ----
  var url = location.href.split('#')[0];
  var title = document.title;
  document.querySelectorAll('[data-share]').forEach(function (a) {
    if (a.getAttribute('data-share') === 'x') {
      a.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(url);
    } else if (a.getAttribute('data-share') === 'line') {
      a.href = 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(url);
    }
  });
})();
