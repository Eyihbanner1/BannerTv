import type { ContentType } from '@bannertv/protocol';

/** What a phrase in Search means. */
export type IntentKind =
  /** A genre catalogs filter by: "comedy", "scary", "sci fi". */
  | 'genre'
  /** A kind of title no catalog genre names, such as stand-up or true crime; genres are the stand-in. */
  | 'mood'
  /** A language or country of origin: "korean", "bollywood". */
  | 'language'
  /** For children and families: "kids", "family films". */
  | 'family'
  /** The newest titles: "new", "latest". */
  | 'new'
  /** One year: "2024". */
  | 'year'
  /** A decade: "90s", "the eighties". */
  | 'decade';

/**
 * What TMDB knows the phrase by, for when Search may ask TMDB (ADR 0004 keeps
 * TMDB out of Search for now). Only ids checked on TMDB's own pages are here.
 */
export interface TmdbHint {
  keywords?: readonly number[];
  movieGenres?: readonly number[];
  tvGenres?: readonly number[];
  /** ISO 639-1, TMDB's with_original_language. */
  language?: string;
  /** ISO 3166-1, TMDB's with_origin_country. */
  country?: string;
}

export interface VocabularyEntry {
  /** Stable, [a-z0-9-] only: keys and tests use it. */
  id: string;
  kind: IntentKind;
  /** As a row names it: "Comedy", "Stand-up comedy". */
  label: string;
  /** The catalog genres (IMDb's names, as Cinemeta lists them) that stand for it, best first. */
  genres: readonly string[];
  /** The types it applies to, when not every type (Reality TV is a series genre). */
  types?: readonly ContentType[];
  tmdb?: TmdbHint;
  /** Every way of saying it, in lower case; plurals and spelling variants are matched for them. */
  phrases: readonly string[];
}

/*
 * One entry a line: id | kind | label | genres | types | TMDB | phrases.
 * Kinds: g genre, m mood, l language, f family, n new. TMDB tokens: k
 * keywords, m film genres, t series genres (dot-separated ids), l language,
 * c country. Genre names are Cinemeta's: its Popular catalogs filter by them.
 * Keyword ids are TMDB's (themoviedb.org/keyword/<id>), checked 6 Nov 2026.
 */
const TABLE = `
action|g|Action|Action||m28 t10759|action,action packed,martial arts,kung fu,karate,shoot em up,explosion,blockbuster,adrenaline,fighting
adventure|g|Adventure|Adventure||m12 t10759|adventure,adventurous,quest,treasure hunt,swashbuckler,pirate,exploration,survival
animation|g|Animation|Animation||m16 t16|animation,animated,cartoon,toon,stop motion,claymation,cgi
biography|g|Biography|Biography|||biography,biopic,biographical,true story,based on a true story,life story,real life story
comedy|g|Comedy|Comedy||m35 t35|comedy,funny,hilarious,laugh,humour,humor,sitcom,spoof,parody,satire,slapstick,light hearted,lighthearted,dark comedy,black comedy
crime|g|Crime|Crime||m80 t80|crime,criminal,gangster,mafia,mob,organised crime,organized crime,cop,police,noir,film noir,cartel,narco
documentary|g|Documentary|Documentary||m99 t99|documentary,doc,docuseries,docu series,non fiction,nonfiction,factual,nature,wildlife
drama|g|Drama|Drama||m18 t18|drama,dramatic,tearjerker,tear jerker,emotional,period drama,costume drama,courtroom,legal drama,medical drama
fantasy|g|Fantasy|Fantasy||m14 t10765|fantasy,magic,magical,wizard,witch,dragon,sword and sorcery,fairy tale,fairytale,myth,mythology,mythical,elves
history|g|History|History||m36|history,historical,period piece,ancient,medieval,victorian,viking,tudor
horror|g|Horror|Horror||m27|horror,scary,spooky,frightening,terrifying,creepy,slasher,zombie,vampire,ghost,haunted,haunting,monster,possession,exorcism,gore,horror comedy
mystery|g|Mystery|Mystery||m9648 t9648|mystery,mysterious,whodunit,whodunnit,murder mystery,detective,sleuth
romance|g|Romance|Romance||m10749|romance,romantic,love story,date night,love
romcom|g|Romantic comedy|Romance,Comedy||m10749.35|rom com,romcom,romantic comedy
scifi|g|Sci-fi|Sci-Fi||m878 t10765|sci fi,scifi,science fiction,sf,space,outer space,alien,robot,time travel,dystopia,dystopian,cyberpunk,futuristic,space opera,post apocalyptic,apocalyptic
sport|g|Sport|Sport|||sport,sporting,sports drama,sport drama,boxing
thriller|g|Thriller|Thriller||m53|thriller,suspense,suspenseful,psychological,psychological thriller,edge of your seat,tense,spy,espionage,conspiracy,political thriller,serial killer
war|g|War|War||m10752 t10768|war,wartime,world war,world war 2,world war ii,ww2,wwii,ww1,wwi,military,soldier,army,battle
western|g|Western|Western||m37 t37|western,cowboy,wild west,spaghetti western,gunslinger
reality|g|Reality TV|Reality-TV|series|t10764|reality,reality tv,reality show,reality television,dating show,cooking show,baking show,competition show
talk|g|Talk show|Talk-Show|series|t10767|talk show,chat show,late night,late night show
gameshow|g|Game show|Game-Show|series||game show,gameshow,quiz show,quiz,panel show
standup|m|Stand-up comedy|Comedy||k9716.356038.362573 m35 t35|stand up,standup,stand up comedy,stand up special,comedy special,comedian,live comedy,stand up show
truecrime|m|True crime|Documentary,Crime||k33722 m99.80 t99.80|true crime,real crime,murder doc,murder documentary,crime documentary,crime doc,true crime documentary,cold case
heist|m|Heist|Crime||k10051|heist,robbery,bank robbery,caper,con artist,heist thriller
anime|m|Anime|Animation||k210024 m16 t16 lja|anime,japanese animation,shonen,shounen,isekai
comingofage|m|Coming of age|Drama||k10683.376648|coming of age,growing up,teen,teenage,teenager,high school,adolescence
feelgood|m|Feel-good|Comedy,Family||k319357.334465 m35.10751|feel good,feelgood,wholesome,uplifting,heartwarming,heart warming,cosy,cozy,comforting,cheerful,inspiring,inspirational
superhero|m|Superheroes|Action,Sci-Fi|||superhero,super hero,comic book,comic book movie
christmas|m|Christmas|Family|||christmas,xmas,festive,holiday season
musical|m|Music and musicals|||m10402|music,musical,concert,music documentary
family|f|Family|Family||m10751 t10751.10762|family,family friendly,kid,child,children,childrens,for kids,kid friendly,all ages,little ones,toddler,preschool
korean|l|Korean|||lko|korean,k drama,kdrama,korean drama
japanese|l|Japanese|||lja|japanese,j drama,jdrama
bollywood|l|Bollywood|||lhi cIN|bollywood,hindi,indian
nollywood|l|Nollywood|||cNG|nollywood,nigerian
chinese|l|Chinese|||lzh|chinese,mandarin,cantonese,c drama,cdrama
spanish|l|Spanish|||les|spanish,spanish language,telenovela
french|l|French|||lfr|french
german|l|German|||lde|german
italian|l|Italian|||lit|italian
turkish|l|Turkish|||ltr|turkish,turkish drama,dizi
british|l|British|||cGB|british,uk
new|n|New||||new,newest,latest,recent,new release,just released,this year,brand new
`;

const KINDS: Record<string, IntentKind> = {
  g: 'genre',
  m: 'mood',
  l: 'language',
  f: 'family',
  n: 'new',
};

function ids(value: string): number[] {
  return value.split('.').map(Number);
}

function readTmdb(field: string): TmdbHint | undefined {
  if (field === '') return undefined;
  const hint: TmdbHint = {};
  for (const token of field.split(' ')) {
    const value = token.slice(1);
    switch (token.charAt(0)) {
      case 'k':
        hint.keywords = ids(value);
        break;
      case 'm':
        hint.movieGenres = ids(value);
        break;
      case 't':
        hint.tvGenres = ids(value);
        break;
      case 'l':
        hint.language = value;
        break;
      case 'c':
        hint.country = value;
        break;
    }
  }
  return hint;
}

function list(field: string): string[] {
  return field
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

let entries: readonly VocabularyEntry[] | undefined;

/**
 * Every phrase Search understands, read from the table the first time it is
 * asked for: nothing is parsed while the app starts.
 */
export function vocabulary(): readonly VocabularyEntry[] {
  if (entries) return entries;
  const read: VocabularyEntry[] = [];
  for (const line of TABLE.split('\n')) {
    if (line.trim() === '') continue;
    const [id = '', kind = '', label = '', genres = '', types = '', tmdb = '', phrases = ''] =
      line.split('|');
    const entry: VocabularyEntry = {
      id,
      kind: KINDS[kind] ?? 'genre',
      label,
      genres: list(genres),
      phrases: list(phrases),
    };
    if (types !== '') entry.types = list(types) as ContentType[];
    const hint = readTmdb(tmdb.trim());
    if (hint) entry.tmdb = hint;
    read.push(entry);
  }
  entries = read;
  return read;
}
