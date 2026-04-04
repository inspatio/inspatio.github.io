window.HELP_IMPROVE_VIDEOJS = false;

// Injected by generate_page.py from config.json
const COMPARE_ITEMS = [
  {
    "scene_label": "coffee_martini",
    "method_label": "vs RealTime4DGS",
    "type": "video",
    "before": "./static/videos/comparison/coffee_martini_RealTime4DGS.mp4",
    "after": "./static/videos/comparison/coffee_martini_ours.mp4"
  },
  {
    "scene_label": "cook_spanish",
    "method_label": "vs 4DGaussians",
    "type": "video",
    "before": "./static/videos/comparison/cook_spanish_4DGaussians.mp4",
    "after": "./static/videos/comparison/cook_spanish_ours.mp4"
  },
  {
    "scene_label": "coffee_martini",
    "method_label": "vs MonoFusion",
    "type": "video",
    "before": "./static/videos/comparison/coffee_martini_MonoFusion.mp4",
    "after": "./static/videos/comparison/coffee_martini_ours_50frame.mp4"
  },
  {
    "scene_label": "flame_salmon",
    "method_label": "vs MonoFusion",
    "type": "video",
    "before": "./static/videos/comparison/flame_salmon_MonoFusion.mp4",
    "after": "./static/videos/comparison/flame_salmon_ours.mp4"
  },
  {
    "scene_label": "birthday",
    "method_label": "vs MonoFusion",
    "type": "video",
    "before": "./static/videos/comparison/birthday_MonoFusion.mp4",
    "after": "./static/videos/comparison/birthday_ours.mp4"
  }
];

$(document).ready(function () {

  // --- 1. Navbar burger ---
  $(".navbar-burger").click(function () {
    $(".navbar-burger, .navbar-menu").toggleClass("is-active");
  });

  // --- 2. Results custom carousel ---
  initResultsCarousel();

  // --- 3. bulmaSlider (required by library) ---
  bulmaSlider.attach();

  // --- 4. Media comparison slider ---
  initMediaCompare();
  initCompareSwitcher();
});

// ---------------------------------------------------------------------------
// Media comparison drag slider
// ---------------------------------------------------------------------------
function initMediaCompare() {
  var wrapper = document.getElementById('media-compare');
  if (!wrapper) return;

  var divider = wrapper.querySelector('.compare-divider');
  var afterEl = wrapper.querySelector('.compare-media-after');
  var dragging = false;

  // Set explicit initial position via inline style (CSS class sets the default,
  // but setPosition writes inline style, so initialise inline to stay consistent)
  afterEl.style.clipPath = 'inset(0 0 0 50%)';
  divider.style.left = '50%';

  function setPosition(clientX) {
    var rect = wrapper.getBoundingClientRect();
    var x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    var pct = (x / rect.width) * 100;
    afterEl.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
    divider.style.left = pct + '%';
  }

  wrapper.addEventListener('mousedown', function (e) {
    dragging = true;
    setPosition(e.clientX);
    e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    if (dragging) setPosition(e.clientX);
  });
  window.addEventListener('mouseup', function () { dragging = false; });

  wrapper.addEventListener('touchstart', function (e) {
    dragging = true;
    setPosition(e.touches[0].clientX);
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', function (e) {
    if (dragging) setPosition(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchend', function () { dragging = false; });

  syncVideos();

  // Explicitly play both videos (autoplay on programmatically-inserted elements
  // may not fire without a user gesture in some browsers)
  var beforeVid = wrapper.querySelector('.compare-media-before');
  var afterVid  = wrapper.querySelector('.compare-media-after');
  if (beforeVid && beforeVid.tagName === 'VIDEO') beforeVid.play().catch(function(){});
  if (afterVid  && afterVid.tagName  === 'VIDEO') afterVid.play().catch(function(){});
}

// ---------------------------------------------------------------------------
// Results custom carousel (variable-width items, loop, prev/next arrows)
// ---------------------------------------------------------------------------
function initResultsCarousel() {
  var track    = document.querySelector('.rsc-track');
  var viewport = document.querySelector('.rsc-viewport');
  var btnPrev  = document.querySelector('.rsc-prev');
  var btnNext  = document.querySelector('.rsc-next');
  if (!track || !viewport) return;

  // Play all videos
  track.querySelectorAll('video').forEach(function(v) { v.play().catch(function(){}); });

  // Wait for videos to load so we know their natural widths, then clone for infinite loop
  var items = Array.from(track.querySelectorAll('.rsc-item'));
  var GAP = 8; // must match CSS gap

  function getTotalWidth() {
    return items.reduce(function(sum, el) {
      return sum + el.offsetWidth + GAP;
    }, 0);
  }

  // Clone all items and append for seamless loop
  function buildLoop() {
    // Remove any old clones
    track.querySelectorAll('.rsc-item-clone').forEach(function(el) { el.remove(); });
    items.forEach(function(el) {
      var clone = el.cloneNode(true);
      clone.classList.add('rsc-item-clone');
      clone.querySelectorAll('video').forEach(function(v) { v.play().catch(function(){}); });
      track.appendChild(clone);
    });
  }

  // Advance by one item width (to the right)
  function scrollByItem(dir) {
    var item = items[0];
    var step = item.offsetWidth + GAP;
    var current = viewport.scrollLeft;
    var total   = getTotalWidth();

    var next = current + dir * step;
    // Wrap: if scrolled past the cloned section, jump back silently
    if (next >= total) {
      viewport.scrollLeft = next - total;
      next = viewport.scrollLeft + dir * step;
    } else if (next < 0) {
      viewport.scrollLeft = next + total;
      next = viewport.scrollLeft + dir * step;
    }
    viewport.scrollTo({ left: next, behavior: 'smooth' });
  }

  // Infinite-scroll: when user scrolls into the clone zone, silently jump
  viewport.addEventListener('scroll', function() {
    var total = getTotalWidth();
    if (viewport.scrollLeft >= total) {
      viewport.scrollLeft -= total;
    } else if (viewport.scrollLeft < 0) {
      viewport.scrollLeft += total;
    }
  });

  if (btnPrev) btnPrev.addEventListener('click', function() { scrollByItem(-1); });
  if (btnNext) btnNext.addEventListener('click', function() { scrollByItem(1); });

  // Wait for layout (videos report offsetWidth=0 before metadata loads)
  window.addEventListener('load', buildLoop);
  setTimeout(buildLoop, 500); // fallback
}

function syncVideos() {
  var wrapper = document.getElementById('media-compare');
  if (!wrapper || wrapper.dataset.type !== 'video') return;

  var before = wrapper.querySelector('.compare-media-before');
  var after  = wrapper.querySelector('.compare-media-after');
  if (!before || !after || before.tagName !== 'VIDEO') return;

  before.addEventListener('timeupdate', function () {
    if (Math.abs(after.currentTime - before.currentTime) > 0.1) {
      after.currentTime = before.currentTime;
    }
  });
}

// ---------------------------------------------------------------------------
// Compare item switcher
// ---------------------------------------------------------------------------
function initCompareSwitcher() {
  var wrapper = document.getElementById('media-compare');
  if (!wrapper) return;

  var buttons = document.querySelectorAll('.compare-switcher .button');
  var prevBtn = document.getElementById('compare-prev');
  var nextBtn = document.getElementById('compare-next');
  var currentIndex = Math.max(0, Array.from(buttons).findIndex(function (b) { return b.classList.contains('is-active'); }));
  var autoAdvanceTimer = null;

  function setActiveButton(idx) {
    buttons.forEach(function (b) { b.classList.remove('is-active'); });
    if (buttons[idx]) buttons[idx].classList.add('is-active');
  }

  function clearAutoAdvanceTimer() {
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function goToNext() {
    if (!COMPARE_ITEMS.length) return;
    var nextIndex = (currentIndex + 1) % COMPARE_ITEMS.length;
    applyCompareItem(nextIndex);
  }

  function goToPrev() {
    if (!COMPARE_ITEMS.length) return;
    var prevIndex = (currentIndex - 1 + COMPARE_ITEMS.length) % COMPARE_ITEMS.length;
    applyCompareItem(prevIndex);
  }

  function bindAutoAdvance() {
    clearAutoAdvanceTimer();
    if (wrapper._compareEndedHandler && wrapper._compareBoundVideo) {
      wrapper._compareBoundVideo.removeEventListener('ended', wrapper._compareEndedHandler);
      wrapper._compareEndedHandler = null;
      wrapper._compareBoundVideo = null;
    }

    if (wrapper.dataset.type !== 'video') return;
    var afterVideo = wrapper.querySelector('.compare-media-after');
    if (!afterVideo || afterVideo.tagName !== 'VIDEO') return;

    var onEnded = function () {
      if (!COMPARE_ITEMS.length) return;
      clearAutoAdvanceTimer();
      autoAdvanceTimer = setTimeout(function () {
        goToNext();
      }, 2000);
    };
    afterVideo.addEventListener('ended', onEnded);
    wrapper._compareEndedHandler = onEnded;
    wrapper._compareBoundVideo = afterVideo;
  }

  function applyCompareItem(idx) {
    var item = COMPARE_ITEMS[idx];
    if (!item) return;

    clearAutoAdvanceTimer();
    currentIndex = idx;
    setActiveButton(idx);

    var currentType = wrapper.dataset.type;
    var newType = item.type;
    wrapper.dataset.type = newType;

    var labelLeft  = document.getElementById('compare-label-left');
    var labelRight = document.getElementById('compare-label-right');
    if (labelLeft)  labelLeft.textContent  = item.method_label.replace('vs ', '');
    if (labelRight) labelRight.textContent = 'Ours';

    if (currentType === newType) {
      var beforeEl = wrapper.querySelector('.compare-media-before');
      var afterEl  = wrapper.querySelector('.compare-media-after');
      if (newType === 'video') {
        beforeEl.querySelector('source').src = item.before;
        afterEl.querySelector('source').src  = item.after;
        beforeEl.load(); beforeEl.play().catch(function(){});
        afterEl.load();  afterEl.play().catch(function(){});
      } else {
        beforeEl.src = item.before;
        afterEl.src  = item.after;
      }
    } else {
      replaceMediaElements(wrapper, item);
      syncVideos();
    }

    bindAutoAdvance();
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(btn.dataset.index, 10);
      applyCompareItem(idx);
    });
  });
  if (prevBtn) prevBtn.addEventListener('click', goToPrev);
  if (nextBtn) nextBtn.addEventListener('click', goToNext);

  bindAutoAdvance();
}

function replaceMediaElements(wrapper, item) {
  var oldBefore = wrapper.querySelector('.compare-media-before');
  var oldAfter  = wrapper.querySelector('.compare-media-after');

  function makeEl(cls, src, type) {
    var el;
    if (type === 'video') {
      el = document.createElement('video');
      el.autoplay = true;
      el.muted    = true;
      el.setAttribute('playsinline', '');
      var src_el = document.createElement('source');
      src_el.src  = src;
      src_el.type = 'video/mp4';
      el.appendChild(src_el);
    } else {
      el = document.createElement('img');
      el.src = src;
      el.alt = '';
    }
    el.className = 'compare-media ' + cls;
    return el;
  }

  var newBefore = makeEl('compare-media-before', item.before, item.type);
  var newAfter  = makeEl('compare-media-after',  item.after,  item.type);

  var currentClip = oldAfter ? oldAfter.style.clipPath : 'inset(0 0 0 50%)';
  newAfter.style.clipPath = currentClip;

  wrapper.replaceChild(newBefore, oldBefore);
  wrapper.replaceChild(newAfter,  oldAfter);
}
