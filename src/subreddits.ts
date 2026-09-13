/**
 * One subreddit per NHL franchise, plus the league-wide one for stories that
 * cross team lines. Names are current as of this writing — reddit renames and
 * merges subs occasionally, so if fetchHot() 404s on one, check it hasn't moved.
 */
export const TEAM_SUBREDDITS: Record<string, string> = {
  ANA: "AnaheimDucks",
  BOS: "BostonBruins",
  BUF: "sabres",
  CGY: "CalgaryFlames",
  CAR: "Canes",
  CHI: "hawks",
  COL: "ColoradoAvalanche",
  CBJ: "BlueJackets",
  DAL: "DallasStars",
  DET: "DetroitRedWings",
  EDM: "EdmontonOilers",
  FLA: "FloridaPanthers",
  LAK: "losangeleskings",
  MIN: "wildhockey",
  MTL: "Habs",
  NSH: "Predators",
  NJD: "DevilsHockey",
  NYI: "NewYorkIslanders",
  NYR: "rangers",
  OTT: "Ottawasenators",
  PHI: "flyers",
  PIT: "penguins",
  SJS: "SanJoseSharks",
  SEA: "SeattleKraken",
  STL: "stlouisblues",
  TBL: "tampabaylightning",
  TOR: "leafs",
  UTA: "UtahHC",
  VAN: "canucks",
  VGK: "goldenknights",
  WSH: "caps",
  WPG: "winnipegjets",
};

/** League-wide — for stories bigger than one team (drafts, trades, awards). */
export const LEAGUE_SUBREDDIT = "hockey";
