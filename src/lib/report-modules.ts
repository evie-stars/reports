import { ReportModule, SearchType } from "@prisma/client";

export function hasRankTracking(modules: ReportModule[]) {
  return modules.includes(ReportModule.rankings) || modules.includes(ReportModule.maps);
}

export function enabledRankSearchTypes(modules: ReportModule[], legacySearchTypes: SearchType[] = []) {
  const searchTypes: SearchType[] = [];
  if (modules.includes(ReportModule.rankings)) searchTypes.push(SearchType.organic);
  if (
    modules.includes(ReportModule.maps) ||
    (!modules.includes(ReportModule.maps) && legacySearchTypes.includes(SearchType.maps))
  ) {
    searchTypes.push(SearchType.maps);
  }
  return searchTypes;
}
