function openModal(src) {
  const modal = document.getElementById('modal');
  const modalImage = document.getElementById('modalImage');
  modalImage.src = src;
  modal.classList.add('active');
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('active');
}

function switchTab(tabName) {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(function(tab) {
    tab.classList.remove('active');
  });
  contents.forEach(function(content) {
    content.classList.remove('active');
  });
  
  const targetTab = Array.from(tabs).find(function(tab) {
    return tab.getAttribute('onclick').includes(tabName);
  });
  if (targetTab) targetTab.classList.add('active');
  const targetContent = document.getElementById(tabName + '-content');
  if (targetContent) targetContent.classList.add('active');
  
  initDiffCards(targetContent || document);
  if (typeof initVisualReview === 'function') initVisualReview();
  
  const activeBrowserTab = document.querySelector('.global-browser-tab.active');
  const gbTabs = document.querySelectorAll('.global-browser-tab');
  const browser = gbTabs.length
    ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
    : null;
  switchGlobalBrowser(browser);
}

function switchIteration(iteration) {
  const iterTabs = document.querySelectorAll('.iteration-tab');
  const iterContents = document.querySelectorAll('.iteration-content');
  
  iterTabs.forEach(function(tab) {
    tab.classList.remove('active');
  });
  iterContents.forEach(function(content) {
    content.style.display = 'none';
  });
  
  const targetTab = document.querySelector('.iteration-tab[data-iteration="' + iteration + '"]');
  // 每个主 Tab 内各有一份 .iteration-content；只打开第一份会导致差异 Tab 整段仍为 display:none。
  document.querySelectorAll('.iteration-content[data-iteration="' + iteration + '"]').forEach(function(content) {
    content.style.display = 'block';
  });
  if (targetTab) targetTab.classList.add('active');

  const allScriptRows = document.querySelectorAll('.script-tabs-iteration');
  allScriptRows.forEach(function(row) {
    row.style.display = 'none';
  });
  const scriptRow = document.querySelector('.script-tabs-iteration[data-iteration="' + iteration + '"]');
  // 必须用 flex（与 .script-tabs-iteration 样式一致）。设成 block 会取消 gap/换行间距，按钮会挤叠。
  if (scriptRow) scriptRow.style.display = 'flex';
  
  // 激活该迭代下第一个脚本
  const firstScriptTab = scriptRow ? scriptRow.querySelector('.script-tab') : null;
  if (firstScriptTab) {
    const script = firstScriptTab.getAttribute('data-script');
    if (script) switchScript(iteration, script);
  }

  const searchInput = document.getElementById('scriptSearch');
  if (searchInput && String(searchInput.value || '').trim()) {
    filterScripts(searchInput.value);
  }
  
  const activeBrowserTab = document.querySelector('.global-browser-tab.active');
  const gbTabs = document.querySelectorAll('.global-browser-tab');
  const browser = gbTabs.length
    ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
    : null;
  switchGlobalBrowser(browser);
}

function switchScript(iteration, script) {
  const scriptTabs = document.querySelectorAll('.script-tab[data-iteration="' + iteration + '"]');
  const scriptContents = document.querySelectorAll('.script-content[data-iteration="' + iteration + '"]');

  scriptTabs.forEach(function(tab) {
    tab.classList.remove('active');
  });
  scriptContents.forEach(function(content) {
    content.style.display = 'none';
  });

  const targetTab = document.querySelector('.script-tab[data-iteration="' + iteration + '"][data-script="' + script + '"]');
  // 三个主 Tab 各有一份同名 .script-content；querySelector 只会打开 Optimized 里的第一份，差异 Tab 内面板会一直是 display:none。
  document.querySelectorAll('.script-content[data-iteration="' + iteration + '"][data-script="' + script + '"]').forEach(function(panel) {
    panel.style.display = 'block';
  });
  if (targetTab) targetTab.classList.add('active');

  const activeBrowserTab = document.querySelector('.global-browser-tab.active');
  const gbTabs = document.querySelectorAll('.global-browser-tab');
  const browser = gbTabs.length
    ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
    : null;
  switchGlobalBrowser(browser);
}

function setScriptSearchFeedback(message) {
  const fb = document.getElementById('scriptSearchFeedback');
  const input = document.getElementById('scriptSearch');
  if (fb) fb.textContent = message || '';
  if (input) {
    if (message) input.classList.add('control-input-warn');
    else input.classList.remove('control-input-warn');
  }
}

function filterScripts(query) {
  const activeIterTab = document.querySelector('.iteration-tab.active');
  const iteration = activeIterTab ? activeIterTab.getAttribute('data-iteration') : null;
  if (!iteration) return;

  const q = String(query || '').trim().toLowerCase();
  const tabs = document.querySelectorAll('.script-tab[data-iteration="' + iteration + '"]');
  const tabArr = Array.prototype.slice.call(tabs);

  tabArr.forEach(function(tab) {
    const label = (tab.textContent || '').trim().toLowerCase();
    const title = (tab.getAttribute('title') || '').toLowerCase();
    const scriptKey = (tab.getAttribute('data-script') || '').toLowerCase();
    const hit = q.length === 0 || label.includes(q) || title.includes(q) || scriptKey.includes(q);
    tab.style.display = hit ? 'flex' : 'none';
  });

  if (q.length === 0) {
    setScriptSearchFeedback('');
    return;
  }

  const visible = tabArr.filter(function(t) { return t.style.display !== 'none'; });
  if (visible.length === 0) {
    setScriptSearchFeedback('当前迭代下无匹配脚本，已恢复显示全部');
    tabArr.forEach(function(t) { t.style.display = 'inline-flex'; });
    return;
  }

  setScriptSearchFeedback('');

  const active = document.querySelector('.script-tab.active[data-iteration="' + iteration + '"]');
  if (!active || active.style.display === 'none') {
    const script = visible[0].getAttribute('data-script');
    if (script) switchScript(iteration, script);
  }
}

function toggleStep(stepNumber) {
  const body = document.getElementById('step-body-' + stepNumber);
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
}

function collapseAll(collapse) {
  const bodies = document.querySelectorAll('.comparison-body');
  bodies.forEach(function(body) {
    body.style.display = collapse ? 'none' : 'block';
  });
}

function scriptDiffPanelHasVisibleDiff(panel) {
  if (!panel) return false;
  if (window.getComputedStyle(panel).display === 'none') return false;
  let found = false;
  panel.querySelectorAll('.comparison').forEach(function(comp) {
    if (comp.querySelector('.diff-card.diff-browser-content.active')) {
      found = true;
    }
  });
  return found;
}

/** 当前「浏览器」下无对比卡片时隐藏步骤骨架；有则按步骤显示（仅含当前浏览器有卡片的步骤）。 */
function updateDiffPanelComparisonVisibility(panel) {
  if (!panel || window.getComputedStyle(panel).display === 'none') return;
  panel.querySelectorAll('.comparison').forEach(function(comp) {
    var hasActive = !!comp.querySelector('.diff-card.diff-browser-content.active');
    comp.style.display = hasActive ? 'block' : 'none';
  });
}

function updateDiffEmptyStates() {
  const activeIterTab = document.querySelector('.iteration-tab.active');
  const iteration = activeIterTab ? activeIterTab.getAttribute('data-iteration') : null;
  const activeScriptTab = iteration
    ? document.querySelector('.script-tab.active[data-iteration="' + iteration + '"]')
    : null;
  const script = activeScriptTab ? activeScriptTab.getAttribute('data-script') : null;
  const activeTab = document.querySelector('.tab-content.active');

  if (!iteration || !script || !activeTab) return;

  if (activeTab.id === 'optimized-diff-content') {
    const target = document.querySelector(
      '#optimized-diff-content .script-content[data-iteration="' + iteration + '"][data-script="' + script + '"]'
    );
    const empty = document.getElementById('optimized-diff-empty');
    if (empty && target) {
      var visible = scriptDiffPanelHasVisibleDiff(target);
      empty.style.display = visible ? 'none' : 'flex';
      updateDiffPanelComparisonVisibility(target);
    }
  }

  if (activeTab.id === 'diff-only-content') {
    const target = document.querySelector(
      '#diff-only-content .script-content[data-iteration="' + iteration + '"][data-script="' + script + '"]'
    );
    const empty = document.getElementById('diff-only-empty');
    if (empty && target) {
      var visible2 = scriptDiffPanelHasVisibleDiff(target);
      empty.style.display = visible2 ? 'none' : 'flex';
      updateDiffPanelComparisonVisibility(target);
    }
  }
}

function updateOptimizedBrowserEmptyStates(effectiveBrowser) {
  const root = document.getElementById('optimized-content');
  if (!root) return;
  root.querySelectorAll('.optimized-browser-empty-state').forEach(function(placeholder) {
    if (!effectiveBrowser) {
      placeholder.style.display = 'none';
      return;
    }
    const section = placeholder.closest('.section');
    if (!section) return;
    const hasBrowserBlock = section.querySelector('.browser-content-section[data-browser="' + effectiveBrowser + '"]');
    const inner = placeholder.querySelector('.optimized-browser-empty-inner');
    if (hasBrowserBlock) {
      placeholder.style.display = 'none';
      if (inner) inner.innerHTML = '';
    } else {
      placeholder.style.display = 'block';
      const availStr = section.getAttribute('data-available-browsers') || '';
      const avail = availStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      const names = avail.length ? avail.join('、') : '无（可检查是否仅 Firefox 等被排除的浏览器）';
      if (inner) {
        inner.innerHTML =
          '当前选中的浏览器下暂无截图。本小节数据仅在 <strong>' +
          names +
          '</strong> 下存在，请切换上方「浏览器」筛选。';
      }
    }
  });
}

function updateReportTabsForBrowser(effectiveBrowser) {
  const optimizedTab = document.querySelector('.tab[data-report-tab="optimized"]');
  if (optimizedTab) {
    optimizedTab.style.display = effectiveBrowser === 'cross' ? 'none' : '';
  }
  if (effectiveBrowser === 'cross') {
    const activeContent = document.querySelector('.tab-content.active');
    if (activeContent && activeContent.id === 'optimized-content') {
      switchTab('optimized-diff');
    }
  }
}

function issueRowMatchesGlobalBrowser(row, effectiveBrowser) {
  if (!effectiveBrowser) return true;
  var kind = row.getAttribute('data-kind') || '';
  var browser = row.getAttribute('data-browser') || '';
  if (effectiveBrowser === 'cross') {
    return kind === 'cross-browser';
  }
  if (kind === 'cross-browser') return false;
  return browser === effectiveBrowser;
}

function analysisRowMatchesGlobalBrowser(row, effectiveBrowser) {
  if (!effectiveBrowser) return true;
  var kinds = (row.getAttribute('data-compare-kinds') || '').split(',').filter(Boolean);
  var browsers = (row.getAttribute('data-browsers') || '').split(',').filter(Boolean);
  if (effectiveBrowser === 'cross') {
    return kinds.indexOf('cross-browser') >= 0;
  }
  if (kinds.length === 1 && kinds[0] === 'cross-browser') return false;
  if (browsers.indexOf(effectiveBrowser) < 0) return false;
  return kinds.some(function(k) { return k !== 'cross-browser'; });
}

function updateIssuesAnalysisBrowserFilter(effectiveBrowser) {
  var hasBrowserTabs = document.querySelectorAll('.global-browser-tab').length > 0;
  var filterBrowser = hasBrowserTabs ? effectiveBrowser : '';

  var issueRows = document.querySelectorAll('#issues-content .issues-filter-row');
  var visibleIssues = 0;
  var issueBlockers = 0;
  var issueWarnings = 0;
  issueRows.forEach(function(row) {
    var show = issueRowMatchesGlobalBrowser(row, filterBrowser);
    row.style.display = show ? '' : 'none';
    if (show) {
      visibleIssues++;
      var sev = row.getAttribute('data-severity') || '';
      if (sev === 'blocker') issueBlockers++;
      else if (sev === 'warning') issueWarnings++;
    }
  });

  var issuesTable = document.getElementById('issues-table');
  var issuesEmpty = document.getElementById('issues-browser-empty');
  if (issuesTable) {
    issuesTable.style.display = visibleIssues === 0 && issueRows.length > 0 ? 'none' : '';
  }
  if (issuesEmpty) {
    issuesEmpty.style.display = visibleIssues === 0 && issueRows.length > 0 ? 'flex' : 'none';
  }
  var issueCountEl = document.getElementById('issues-visible-count');
  var issueBlockerEl = document.getElementById('issues-blocker-count');
  var issueWarningEl = document.getElementById('issues-warning-count');
  var issueFilterNote = document.getElementById('issues-filter-note');
  if (issueCountEl && hasBrowserTabs && filterBrowser) {
    issueCountEl.textContent = String(visibleIssues);
    if (issueBlockerEl) issueBlockerEl.textContent = String(issueBlockers);
    if (issueWarningEl) issueWarningEl.textContent = String(issueWarnings);
    if (issueFilterNote) {
      var browserLabel = filterBrowser === 'cross' ? '跨浏览器' : filterBrowser;
      issueFilterNote.textContent = ' · 当前「' + browserLabel + '」筛选';
    }
  } else if (issueFilterNote) {
    issueFilterNote.textContent = '';
  }

  var analysisRows = document.querySelectorAll('#analysis-content .analysis-filter-row');
  var visibleAnalysis = 0;
  var analysisBlockers = 0;
  var analysisWarnings = 0;
  analysisRows.forEach(function(row) {
    var show = analysisRowMatchesGlobalBrowser(row, filterBrowser);
    row.style.display = show ? '' : 'none';
    if (show) {
      visibleAnalysis++;
      var sev = row.getAttribute('data-severity') || '';
      if (sev === 'blocker') analysisBlockers++;
      else if (sev === 'warning') analysisWarnings++;
    }
  });

  document.querySelectorAll('#analysis-content .analysis-script-block').forEach(function(block) {
    var rows = block.querySelectorAll('.analysis-filter-row');
    var hasVisible = false;
    Array.prototype.forEach.call(rows, function(r) {
      if (r.style.display !== 'none') hasVisible = true;
    });
    block.style.display = hasVisible ? '' : 'none';
  });

  var analysisEmpty = document.getElementById('analysis-browser-empty');
  var analysisScriptsHeading = document.querySelector('#analysis-content .analysis-scripts-heading');
  if (analysisEmpty) {
    analysisEmpty.style.display = visibleAnalysis === 0 && analysisRows.length > 0 ? 'flex' : 'none';
  }
  if (analysisScriptsHeading) {
    analysisScriptsHeading.style.display = visibleAnalysis === 0 && analysisRows.length > 0 ? 'none' : '';
  }

  var analysisFilterSummary = document.getElementById('analysis-filter-summary');
  if (analysisFilterSummary) {
    if (hasBrowserTabs && filterBrowser && analysisRows.length > 0) {
      var browserLabel = filterBrowser === 'cross' ? '跨浏览器' : filterBrowser;
      analysisFilterSummary.style.display = '';
      analysisFilterSummary.textContent =
        '当前浏览器「' + browserLabel + '」筛选：' + visibleAnalysis + ' 项 · blocker ' + analysisBlockers + ' · warning ' + analysisWarnings + '（上方总览为全量）';
    } else {
      analysisFilterSummary.style.display = 'none';
      analysisFilterSummary.textContent = '';
    }
  }
}

function switchGlobalBrowser(browser) {
  const tabs = document.querySelectorAll('.global-browser-tab');
  const sections = document.querySelectorAll('.browser-content-section');
  const diffCards = document.querySelectorAll('.diff-card.diff-browser-content');
  let browserForEmptyState = '';
  let effectiveBrowser = '';
  
  tabs.forEach(function(tab) {
    tab.classList.remove('active');
  });
  sections.forEach(function(section) {
    section.classList.remove('active');
  });
  diffCards.forEach(function(card) {
    card.classList.remove('active');
  });
  
  if (tabs.length === 0) {
    sections.forEach(function(section) {
      section.classList.add('active');
    });
    diffCards.forEach(function(card) {
      card.classList.add('active');
    });
  } else {
    let targetTab = browser
      ? document.querySelector('.global-browser-tab[data-browser="' + browser + '"]')
      : null;
    if (!targetTab) {
      targetTab = tabs[0];
    }
    targetTab.classList.add('active');
    effectiveBrowser = targetTab.getAttribute('data-browser') || '';
    browserForEmptyState = effectiveBrowser === 'cross' ? '' : effectiveBrowser;

    if (effectiveBrowser !== 'cross') {
      const targetSections = document.querySelectorAll('.browser-content-section[data-browser="' + effectiveBrowser + '"]');
      targetSections.forEach(function(section) {
        section.classList.add('active');
      });
    }
    const targetDiffCards = document.querySelectorAll('.diff-card.diff-browser-content[data-browser="' + effectiveBrowser + '"]');
    targetDiffCards.forEach(function(card) {
      card.classList.add('active');
    });
  }
  
  const allSubsections = document.querySelectorAll('.step-subsection');
  allSubsections.forEach(function(subsection) {
    const hasActiveSection = subsection.querySelector('.browser-content-section.active');
    const subsectionCount = subsection.querySelector('.subsection-count');
    if (subsectionCount) {
      // 有全局浏览器 Tab 时：徽章表示「当前选中浏览器」下的张数；无匹配浏览器时为 0，不能回退到 data-screenshot-total（那是全浏览器合计，会造成「显示有图但下方为空」的错觉）。
      if (!hasActiveSection) {
        subsectionCount.textContent = '0张';
      } else if (tabs.length === 0) {
        const total = subsection.getAttribute('data-screenshot-total');
        subsectionCount.textContent = (total != null && total !== '' ? total : '0') + '张';
      } else {
        const activeSection = subsection.querySelector('.browser-content-section.active');
        const count = activeSection ? activeSection.getAttribute('data-count') : null;
        subsectionCount.textContent = (count != null && count !== '' ? count : '0') + '张';
      }
    }
  });

  const optRoot = document.getElementById('optimized-content');
  if (optRoot && tabs.length > 0) {
    optRoot.querySelectorAll('.comparison').forEach(function(comparison) {
      const badge = comparison.querySelector('.comparison-header .screenshot-badge');
      if (!badge) return;
      var sum = 0;
      comparison.querySelectorAll('.browser-content-section.active').forEach(function(section) {
        var c = parseInt(section.getAttribute('data-count') || '0', 10);
        if (!isNaN(c)) sum += c;
      });
      badge.textContent = sum + '张';
    });
  }
  
  const activeTab = document.querySelector('.tab-content.active');
  if (
    activeTab &&
    (activeTab.id === 'diff-only-content' || activeTab.id === 'optimized-diff-content')
  ) {
    /* 差异类 Tab 由 updateDiffEmptyStates 控制步骤可见性 */
  } else if (activeTab && activeTab.id === 'optimized-content') {
    activeTab.querySelectorAll('.comparison').forEach(function(comparison) {
      comparison.style.display = 'block';
    });
  } else if (activeTab) {
    activeTab.querySelectorAll('.comparison').forEach(function(comparison) {
      comparison.style.display = 'block';
    });
  }

  updateOptimizedBrowserEmptyStates(browserForEmptyState);
  updateReportTabsForBrowser(effectiveBrowser);
  updateDiffEmptyStates();
  updateIssuesAnalysisBrowserFilter(effectiveBrowser);
}

document.addEventListener('DOMContentLoaded', function() {
  const activeGb = document.querySelector('.global-browser-tab.active');
  const gbTabs = document.querySelectorAll('.global-browser-tab');
  const browser = gbTabs.length
    ? (activeGb ? activeGb.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
    : null;
  switchGlobalBrowser(browser);

  const activeIterTab = document.querySelector('.iteration-tab.active');
  if (activeIterTab) {
    const iteration = activeIterTab.getAttribute('data-iteration');
    if (iteration) {
      switchIteration(iteration);
    }
  }

  updateDiffEmptyStates();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeModal();
    closeCompareModal();
  }
});
