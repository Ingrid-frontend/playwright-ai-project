import { comparisonToUiIssue, type UiIssue } from './ui-issues.js';
import { collectStructureUiIssues } from './structure-check.js';
import {
  extractStepNameFromPath,
  routeFromScreenshotPath,
} from './compare-screenshots-utils.js';

interface TestDirComparisons {
  testDir: string;
  comparisons: Array<{
    stepNumber: number;
    optimizedComparisons: Array<{
      image1Path: string;
      image2Path?: string;
      browser?: string;
      browser2?: string;
      compareKind?: string;
    }>;
    crossBrowserComparisons: Array<{
      image1Path: string;
      image2Path?: string;
      browser?: string;
      browser2?: string;
      compareKind?: string;
    }>;
    optimizedScreenshots: Array<{
      path: string;
      stepName: string;
      browser?: string;
      route?: string;
      timestamp: string;
    }>;
  }>;
}

export function collectAllUiIssues(testDirComparisons: TestDirComparisons[]): UiIssue[] {
  const issues: UiIssue[] = [];
  for (const tdc of testDirComparisons) {
    const structureShots: Array<{
      path: string;
      stepNumber: number;
      stepName: string;
      browser?: string;
      route?: string;
      timestamp: string;
    }> = [];

    for (const comp of tdc.comparisons) {
      const comparisons = [...comp.optimizedComparisons, ...comp.crossBrowserComparisons];
      for (const c of comparisons) {
        const shotPath = c.image2Path || c.image1Path;
        const stepName = extractStepNameFromPath(shotPath);
        const route = routeFromScreenshotPath(shotPath);
        const issue = comparisonToUiIssue(c, {
          scriptKey: tdc.testDir,
          stepNumber: comp.stepNumber,
          stepName,
          browser: c.browser || c.browser2 || 'chrome',
          route,
        });
        if (issue) issues.push(issue);
      }

      for (const s of comp.optimizedScreenshots) {
        structureShots.push({
          path: s.path,
          stepNumber: comp.stepNumber,
          stepName: s.stepName,
          browser: s.browser,
          route: s.route,
          timestamp: s.timestamp,
        });
      }
    }

    issues.push(...collectStructureUiIssues(tdc.testDir, structureShots));
  }
  return issues;
}
