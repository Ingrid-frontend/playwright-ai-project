export function compareReportVizCss(): string {
  return `
    .viz-dashboard { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0 20px; }
    .viz-stat { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 12px 20px; min-width: 100px; text-align: center; }
    .viz-num { display: block; font-size: 22px; font-weight: 600; }
    .viz-num.viz-red { color: #dc3545; }
    .viz-num.viz-yellow { color: #d97706; }
    .viz-num.viz-green { color: #28a745; }
    .viz-label { font-size: 12px; color: #86909c; }
    .viz-pct { font-size: 11px; color: #adb5bd; }

    /* ─── Overview panel (Plan 1) ─── */
    .ov-panel { display: flex; gap: 24px; flex-wrap: wrap; background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ov-left { display: flex; gap: 20px; align-items: center; flex-shrink: 0; }
    .ov-ring-wrap { flex-shrink: 0; }
    .ov-ring { width: 80px; height: 80px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; }
    .ov-ring::after { content: ''; position: absolute; width: 48px; height: 48px; background: #fff; border-radius: 50%; }
    .ov-ring-pct { font-size: 15px; font-weight: 700; color: #1d2129; z-index: 1; line-height: 1; }
    .ov-ring-label { font-size: 10px; color: #86909c; z-index: 1; margin-top: 2px; }
    .ov-stat-grid { display: flex; gap: 16px; }
    .ov-stat { text-align: center; min-width: 56px; }
    .ov-stat-num { display: block; font-size: 20px; font-weight: 700; color: #1d2129; }
    .ov-stat-num.ov-red { color: #dc3545; }
    .ov-stat-num.ov-yellow { color: #d97706; }
    .ov-stat-num.ov-green { color: #28a745; }
    .ov-stat-lbl { font-size: 11px; color: #86909c; display: block; }
    .ov-stat-sub { font-size: 10px; color: #adb5bd; }
    .ov-right { flex: 1; min-width: 280px; display: flex; flex-direction: column; gap: 12px; }
    .ov-dist-section { display: flex; flex-direction: column; gap: 6px; }
    .ov-dist-heading { font-size: 12px; font-weight: 600; color: #4e5969; margin-bottom: 2px; }
    .ov-dist-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .ov-dist-label { width: 64px; text-align: right; color: #4e5969; flex-shrink: 0; }
    .ov-dist-track { flex: 1; height: 10px; background: #f0f0f0; border-radius: 5px; overflow: hidden; }
    .ov-dist-fill { height: 100%; border-radius: 5px; transition: width 0.4s ease; min-width: 0; }
    .ov-dist-count { width: 32px; text-align: left; color: #86909c; font-weight: 600; }
    .ov-meta-row { display: flex; gap: 16px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid #f0f0f0; }
    .ov-meta-item { display: flex; gap: 6px; align-items: center; font-size: 12px; }
    .ov-meta-key { color: #86909c; }
    .ov-meta-val { font-weight: 600; color: #1d2129; }
    .ov-meta-loc { color: #4e5969; }

    /* ─── Diff bar in diff-card header (Plan 2) ─── */
    .diff-bar-wrap { flex: 1; min-width: 60px; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; margin-left: 4px; }
    .diff-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; min-width: 0; }

    /* ─── Heatmap cell values (Plan 4) ─── */
    .hm-cell .hm-val { font-size: 10px; font-weight: 600; color: rgba(0,0,0,0.6); }
    .hm-cell.hm-red .hm-val { color: #991b1b; }
    .hm-cell.hm-yellow .hm-val { color: #92400e; }
    .hm-summary-cell { font-weight: 600; font-size: 11px; background: #f9fafb; color: #374151; }

    /* ─── Summary table (Plan 5) ─── */
    .summary-wrap { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; }
    .summary-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 16px; border-bottom: 1px solid #e8e8e8; background: #fafafa; }
    .summary-toolbar select, .summary-toolbar input { padding: 5px 10px; border: 1px solid #d6d8db; border-radius: 4px; font-size: 13px; }
    .summary-toolbar .summary-hint { font-size: 12px; color: #86909c; margin-left: auto; }
    .summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .summary-table th, .summary-table td { border: 1px solid #e8e8e8; padding: 7px 10px; text-align: left; white-space: nowrap; }
    .summary-table th { background: #f9fafb; cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 1; }
    .summary-table th:hover { background: #e6f4ff; }
    .summary-table th .sort-arrow { font-size: 10px; margin-left: 3px; color: #adb5bd; }
    .summary-table th .sort-arrow.active { color: #1677ff; }
    .summary-table tbody tr { cursor: pointer; transition: background 0.15s ease; }
    .summary-table tbody tr:hover { background: #f0f7ff; }
    .summary-table .st-bar-wrap { display: inline-block; width: 60px; height: 5px; background: #f0f0f0; border-radius: 3px; overflow: hidden; vertical-align: middle; margin-left: 6px; }
    .summary-table .st-bar-fill { height: 100%; border-radius: 3px; }
    .summary-scroll { max-height: 70vh; overflow: auto; }
    .diff-view-toolbar { display: flex; gap: 6px; margin: 8px 0; flex-wrap: wrap; }
    .diff-view-btn { font-size: 12px; padding: 4px 10px; border: 1px solid #d6d8db; background: #fff; border-radius: 4px; cursor: pointer; }
    .diff-view-btn.active { background: #1677ff; color: #fff; border-color: #1677ff; }
    .diff-view-panels { position: relative; min-height: 120px; }
    .diff-view-panel { display: none; }
    .diff-view-panel.active { display: block; }
    .diff-view-side { display: none; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .diff-view-side.active { display: grid; }
    .slider-compare { position: relative; width: 100%; max-width: 960px; margin: 0 auto; user-select: none; overflow: hidden; border-radius: 8px; border: 1px solid #e8e8e8; }
    .slider-img { display: block; width: 100%; height: auto; vertical-align: top; }
    .slider-before { position: relative; z-index: 1; }
    .slider-after-clip { position: absolute; top: 0; left: 0; height: 100%; width: 50%; overflow: hidden; z-index: 2; border-right: 2px solid #1677ff; }
    .slider-after-clip .slider-after { width: 100%; max-width: none; height: 100%; object-fit: cover; object-position: left top; }
    .slider-range { position: absolute; bottom: 8px; left: 8%; width: 84%; z-index: 5; opacity: 0.85; }
    .blink-compare { position: relative; max-width: 960px; margin: 0 auto; cursor: pointer; border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; }
    .blink-img { display: block; width: 100%; height: auto; }
    .blink-b { display: none; }
    .blink-compare.blink-on .blink-a { display: none; }
    .blink-compare.blink-on .blink-b { display: block; }
    .blink-hint { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,.55); color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .overlay-compare { max-width: 960px; margin: 0 auto; }
    .overlay-img { width: 100%; height: auto; border: 1px solid #e8e8e8; border-radius: 8px; }
    .overlay-caption { font-size: 12px; color: #86909c; text-align: center; margin-top: 4px; }
    .diff-trend-wrap { margin-left: 8px; vertical-align: middle; }
    .diff-sparkline { vertical-align: middle; }
    .heatmap-wrap { padding: 8px 0; }
    .heatmap-legend { font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .heatmap-scroll { overflow: auto; max-height: 70vh; }
    .heatmap-table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
    .heatmap-table th, .heatmap-table td { border: 1px solid #e8e8e8; padding: 8px 10px; text-align: center; }
    .heatmap-table th.hm-script { text-align: left; white-space: nowrap; max-width: 160px; }
    .hm-cell { width: 36px; height: 28px; border-radius: 4px; display: inline-block; }
    .hm-cell.hm-red, td.hm-red { background: #fecaca; }
    .hm-cell.hm-yellow, td.hm-yellow { background: #fef3c7; }
    .hm-cell.hm-green, td.hm-green { background: #d1fae5; }
    .diff-card:focus { outline: 2px solid #1677ff; outline-offset: 2px; }
    .viz-filter-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 16px; align-items: center; }
    .viz-filter-row select, .viz-filter-row input { padding: 6px 10px; border: 1px solid #d6d8db; border-radius: 4px; font-size: 13px; }
    .compare-modal { display: none; position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,.85); flex-direction: column; }
    .compare-modal.active { display: flex; }
    .compare-modal-bar { display: flex; gap: 8px; padding: 12px 16px; background: #1d2129; color: #fff; align-items: center; }
    .compare-modal-body { flex: 1; overflow: auto; display: flex; gap: 8px; padding: 16px; }
    .compare-modal-pane { flex: 1; overflow: auto; background: #fff; border-radius: 8px; padding: 8px; }
    .compare-modal-pane img { width: 100%; height: auto; }
    .vr-banner { margin: 8px 16px 16px; padding: 8px 12px; background: #fff7e6; border: 1px solid #ffd591; border-radius: 6px; font-size: 13px; color: #ad6800; }
    .vr-item { margin: 0 16px 24px; border: 1px solid #e8e8e8; border-radius: 8px; padding: 12px; background: #fff; }
    .vr-item-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
    .vr-meta { display: block; font-size: 12px; color: #86909c; margin-top: 4px; }
    .vr-actions { display: flex; gap: 8px; }
    .vr-btn { padding: 6px 12px; border-radius: 4px; border: 1px solid #d6d8db; background: #fff; cursor: pointer; font-size: 13px; }
    .vr-approve { background: #1677ff; color: #fff; border-color: #1677ff; }
    .vr-reject { background: #fff; }
    .vr-cli { font-size: 12px; color: #86909c; word-break: break-all; }
    .vr-regions { margin-top: 10px; font-size: 13px; }
    .vr-regions-title { font-weight: 600; margin-bottom: 4px; }
    .vr-region-list { margin: 0; padding-left: 18px; }
    .vr-region-item.vr-high { color: #cf1322; }
    .vr-region-item.vr-medium { color: #d48806; }
    .vr-region-item.vr-low { color: #8c8c8c; }
    .vr-overlay-wrap { position: relative; max-width: 960px; margin: 0 auto; }
    .vr-box { position: absolute; border: 2px solid #cf1322; pointer-events: none; }
    .vr-box.vr-medium { border-color: #d48806; }
    .vr-item[data-verdict="approved"] { outline: 2px solid #52c41a; }
    .vr-item[data-verdict="rejected"] { outline: 2px solid #ff4d4f; }
  `;
}

export function compareReportVizJs(): string {
  return `
    function initDiffCards(root) {
      (root || document).querySelectorAll('[data-diff-card]').forEach(function(card) {
        if (card.dataset.vizInit) return;
        card.dataset.vizInit = '1';
        var toolbar = card.querySelector('.diff-view-toolbar');
        var panels = card.querySelectorAll('.diff-view-panel, .diff-view-side');
        toolbar.querySelectorAll('.diff-view-btn').forEach(function(btn) {
          if (btn.classList.contains('diff-expand-btn')) return;
          btn.addEventListener('click', function() {
            var view = btn.getAttribute('data-view');
            toolbar.querySelectorAll('.diff-view-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            panels.forEach(function(p) { p.classList.remove('active'); });
            var target = view === 'side' ? card.querySelector('.diff-view-side') : card.querySelector('.' + view + '-compare');
            if (target) target.classList.add('active');
          });
        });
        var slider = card.querySelector('.slider-compare');
        if (slider) {
          var range = slider.querySelector('.slider-range');
          var clip = slider.querySelector('.slider-after-clip');
          var afterImg = slider.querySelector('.slider-after');
          function syncSlider() {
            var pct = Number(range.value);
            clip.style.width = pct + '%';
            if (afterImg && slider.offsetWidth) {
              afterImg.style.width = slider.offsetWidth + 'px';
            }
          }
          range.addEventListener('input', syncSlider);
          window.addEventListener('resize', syncSlider);
          syncSlider();
        }
        var blink = card.querySelector('.blink-compare');
        if (blink) {
          var timer = null;
          blink.addEventListener('click', function() {
            if (timer) { clearInterval(timer); timer = null; blink.classList.remove('blink-on'); return; }
            timer = setInterval(function() { blink.classList.toggle('blink-on'); }, 500);
          });
        }
        var expandBtn = card.querySelector('.diff-expand-btn');
        if (expandBtn) {
          expandBtn.addEventListener('click', function() {
            openCompareModal(card.querySelector('.slider-before')?.src, card.querySelector('.slider-after')?.src);
          });
        }
      });
    }
    function openCompareModal(beforeSrc, afterSrc) {
      var m = document.getElementById('compareModal');
      if (!m) return;
      m.querySelector('.cm-before').src = beforeSrc || '';
      m.querySelector('.cm-after').src = afterSrc || '';
      m.classList.add('active');
    }
    function closeCompareModal() {
      var m = document.getElementById('compareModal');
      if (m) m.classList.remove('active');
    }
    function syncModalScroll(el) {
      var panes = document.querySelectorAll('#compareModal .compare-modal-pane');
      if (panes.length < 2) return;
      panes.forEach(function(p) {
        if (p !== el) p.scrollTop = el.scrollTop;
      });
    }
    function applyVizFilters() {
      var sev = document.getElementById('vizFilterSeverity')?.value || 'all';
      var kind = document.getElementById('vizFilterKind')?.value || 'all';
      var q = (document.getElementById('vizFilterSearch')?.value || '').toLowerCase();
      document.querySelectorAll('[data-diff-card]').forEach(function(card) {
        var ok = true;
        if (sev !== 'all' && card.getAttribute('data-severity') !== sev) ok = false;
        if (kind !== 'all' && card.getAttribute('data-compare-kind') !== kind) ok = false;
        if (q && !card.textContent.toLowerCase().includes(q)) ok = false;
        card.style.display = ok ? '' : 'none';
      });
    }
    var vizCardList = [];
    function refreshVizCardList() {
      vizCardList = Array.from(document.querySelectorAll('[data-diff-card]')).filter(function(c) { return c.offsetParent !== null; });
    }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeCompareModal();
      if (e.key === 'b' && document.getElementById('compareModal')?.classList.contains('active')) {
        var blink = document.querySelector('#compareModal .blink-compare');
        if (blink) blink.click();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        var active = document.activeElement;
        if (!active?.matches?.('[data-diff-card]')) return;
        refreshVizCardList();
        var idx = vizCardList.indexOf(active);
        if (idx < 0) return;
        var next = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
        if (vizCardList[next]) { vizCardList[next].focus(); vizCardList[next].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    });
    document.addEventListener('DOMContentLoaded', function() {
      initDiffCards(document);
      ['vizFilterSeverity', 'vizFilterKind', 'vizFilterSearch'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', applyVizFilters);
        if (el) el.addEventListener('change', applyVizFilters);
      });
    });

    /* ─── Summary table sort & filter (Plan 5) ─── */
    var summarySortCol = 'diff';
    var summarySortDesc = true;
    function sortSummaryTable(col) {
      if (summarySortCol === col) { summarySortDesc = !summarySortDesc; } else { summarySortCol = col; summarySortDesc = true; }
      var tbody = document.querySelector('#summary-table tbody');
      if (!tbody) return;
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var va = a.getAttribute('data-sort-' + col) || '';
        var vb = b.getAttribute('data-sort-' + col) || '';
        var na = parseFloat(va), nb = parseFloat(vb);
        var cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb, 'zh-CN');
        return summarySortDesc ? -cmp : cmp;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      document.querySelectorAll('#summary-table th .sort-arrow').forEach(function(s) { s.className = 'sort-arrow'; });
      var th = document.querySelector('#summary-table th[data-col="' + col + '"] .sort-arrow');
      if (th) { th.className = 'sort-arrow active'; th.textContent = summarySortDesc ? '↓' : '↑'; }
    }
    function filterSummaryTable() {
      var sev = (document.getElementById('summaryFilterSev') || {}).value || 'all';
      var kind = (document.getElementById('summaryFilterKind') || {}).value || 'all';
      var q = ((document.getElementById('summarySearch') || {}).value || '').toLowerCase();
      document.querySelectorAll('#summary-table tbody tr').forEach(function(r) {
        var ok = true;
        if (sev !== 'all' && r.getAttribute('data-sort-severity') !== sev) ok = false;
        if (kind !== 'all' && r.getAttribute('data-sort-kind') !== kind) ok = false;
        if (q && r.textContent.toLowerCase().indexOf(q) < 0) ok = false;
        r.style.display = ok ? '' : 'none';
      });
    }

    /* ─── Issues table sort (Plan 6) ─── */
    var issuesSortCol = 'severity';
    var issuesSortDesc = true;
    function sortIssues(col) {
      if (issuesSortCol === col) { issuesSortDesc = !issuesSortDesc; } else { issuesSortCol = col; issuesSortDesc = true; }
      var tbody = document.querySelector('#issues-table tbody');
      if (!tbody) return;
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var va = a.getAttribute('data-sort-' + col) || '';
        var vb = b.getAttribute('data-sort-' + col) || '';
        var na = parseFloat(va), nb = parseFloat(vb);
        var cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb, 'zh-CN');
        return issuesSortDesc ? -cmp : cmp;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      document.querySelectorAll('#issues-table th .sort-arrow').forEach(function(s) { s.className = 'sort-arrow'; });
      var th = document.querySelector('#issues-table th[data-sort="' + col + '"] .sort-arrow');
      if (th) { th.className = 'sort-arrow active'; th.textContent = issuesSortDesc ? '↓' : '↑'; }
    }

    function visualReviewCli(item, verdict) {
      return 'npm run visual-review -- --verdict=' + verdict
        + ' --script=' + (item.getAttribute('data-script') || '')
        + ' --run=' + (item.getAttribute('data-run') || '')
        + ' --step=' + (item.getAttribute('data-step') || '')
        + ' --browser=' + (item.getAttribute('data-browser') || 'chrome')
        + ' --issueId=' + (item.getAttribute('data-issue-id') || '');
    }
    function initVisualReview() {
      document.querySelectorAll('.vr-toggle-low').forEach(function(btn) {
        if (btn.dataset.vrInit) return;
        btn.dataset.vrInit = '1';
        btn.addEventListener('click', function() {
          var wrap = btn.closest('.vr-regions') || btn.closest('.diff-card');
          if (!wrap) return;
          wrap.querySelectorAll('[data-low="1"]').forEach(function(el) {
            el.style.display = el.style.display === 'none' ? '' : 'none';
          });
        });
      });
      document.querySelectorAll('.vr-copy-cli').forEach(function(btn) {
        if (btn.dataset.vrInit) return;
        btn.dataset.vrInit = '1';
        btn.addEventListener('click', function() {
          var item = btn.closest('.vr-item');
          var code = item ? item.querySelector('.vr-cli code') : null;
          if (code && navigator.clipboard) navigator.clipboard.writeText(code.textContent || '');
        });
      });
      document.querySelectorAll('.vr-btn[data-verdict]').forEach(function(btn) {
        if (btn.dataset.vrInit) return;
        btn.dataset.vrInit = '1';
        btn.addEventListener('click', function() {
          var item = btn.closest('.vr-item');
          if (!item) return;
          var verdict = btn.getAttribute('data-verdict');
          var payload = {
            verdict: verdict,
            issueId: item.getAttribute('data-issue-id'),
            scriptKey: item.getAttribute('data-script'),
            runTimestamp: item.getAttribute('data-run'),
            stepFileName: item.getAttribute('data-step'),
            browser: item.getAttribute('data-browser')
          };
          try { localStorage.setItem('vr-' + payload.issueId, verdict); } catch (e) {}
          item.setAttribute('data-verdict', verdict);
          fetch('/api/visual-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function(res) {
            if (!res.ok) throw new Error('http ' + res.status);
            return res.json();
          }).then(function() {
            btn.textContent = verdict === 'approved' ? 'Approved' : 'Rejected';
          }).catch(function() {
            var cli = visualReviewCli(item, verdict);
            if (navigator.clipboard) navigator.clipboard.writeText(cli);
            alert('无法写入 Golden（静态报告）。已复制 CLI：\\n' + cli);
          });
        });
      });
    }
    document.addEventListener('DOMContentLoaded', function() {
      initVisualReview();
    });
  `;
}
