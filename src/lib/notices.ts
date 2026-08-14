// Carrying a "why did I end up here?" reason across a navigation.
//
// The bug this fixes: several handlers did
//
//     toast({ title: "Room not found", ... });
//     window.location.href = "/rooms";
//
// A full page navigation tears down the document, and with it the toast that
// was created microseconds earlier -- so the user was bounced to /rooms with
// no explanation at all, every time. A QA pass hit this for all three
// redirect reasons (not a member, room not found, sign-in required).
//
// The fix is to put the reason in the URL the browser is being sent to, and
// have the destination page consume it on arrival. A query param is the right
// carrier here rather than sessionStorage: it survives a hard navigation, it
// works for a link the user clicks (not just a scripted redirect), and it is
// visible/debuggable. It is also stripped from the URL once shown, so a
// refresh or a shared link doesn't replay a stale message.
//
// The notice CODE is what travels -- never the message text. A page that
// rendered arbitrary text from its own query string would be a trivially
// shareable way to put words in this app's mouth ("your card was declined,
// email us at ..."); an unknown code is simply ignored.

export type NoticeCode =
  | "sign-in-required"
  | "not-a-member"
  | "room-not-found"
  | "room-closed"
  | "no-match-yet";

export interface Notice {
  title: string;
  /** `room` is the 4-letter code when the destination knows one. */
  describe: (room?: string | null) => string;
  variant?: "default" | "destructive";
}

export const NOTICES: Record<NoticeCode, Notice> = {
  "sign-in-required": {
    title: "Sign in to continue",
    describe: (room) =>
      room
        ? `Room ${room} is waiting for you -- sign in and we'll take you straight there.`
        : "Sign in to host or join a group swiping room.",
  },
  // Deliberately covers both causes in one honest sentence. RLS makes the two
  // indistinguishable to the client on purpose -- fetchRoomByCode() returns
  // null for "no such room" and for "exists, but you're not in it" alike, and
  // that is the property that stops this app from being a room-existence
  // oracle. Claiming one specific cause would be a guess presented as fact.
  "not-a-member": {
    title: "That room isn't available",
    describe: (room) =>
      room
        ? `Room ${room} either doesn't exist any more, or you're not a member of it. Ask for the code or the join link to get in.`
        : "That room either doesn't exist any more, or you're not a member of it.",
    variant: "destructive",
  },
  "room-not-found": {
    title: "Room not found",
    describe: (room) =>
      room ? `Room ${room} doesn't exist any more.` : "That room doesn't exist any more.",
    variant: "destructive",
  },
  "room-closed": {
    title: "That room was closed",
    describe: (room) =>
      room
        ? `Room ${room} was closed by its host, so the session ended.`
        : "The room was closed by its host, so the session ended.",
    variant: "destructive",
  },
  "no-match-yet": {
    title: "No match yet",
    describe: (room) =>
      room
        ? `Room ${room} hasn't agreed on a cuisine yet -- keep swiping.`
        : "That room hasn't agreed on a cuisine yet -- keep swiping.",
  },
};

const NOTICE_PARAM = "notice";
const ROOM_PARAM = "room";
const REDIRECT_PARAM = "redirect";

function isNoticeCode(value: string | null): value is NoticeCode {
  return value !== null && Object.prototype.hasOwnProperty.call(NOTICES, value);
}

/**
 * Only same-origin, path-absolute destinations are ever honoured.
 *
 * `?redirect=` exists so an invited friend who lands on /swipe?room=ABCD while
 * signed out comes back to that exact page after logging in. Without this
 * check it would also be an open redirect: `/login?redirect=https://evil.example`
 * would hand a freshly-authenticated user straight to someone else's site with
 * this app's branding behind them. "//evil.example" is rejected too -- browsers
 * read a protocol-relative URL as an absolute one.
 */
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  return value;
}

/** Builds `path` with a notice code (and optional room/redirect) attached. */
export function withNotice(
  path: string,
  code: NoticeCode,
  options: { room?: string | null; redirect?: string | null } = {}
): string {
  const [base, existingQuery = ""] = path.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set(NOTICE_PARAM, code);
  if (options.room) params.set(ROOM_PARAM, options.room);
  const redirect = safeRedirectPath(options.redirect ?? null);
  if (redirect) params.set(REDIRECT_PARAM, redirect);
  return `${base}?${params.toString()}`;
}

/** Navigates to `path`, carrying the reason so the destination can show it. */
export function redirectWithNotice(
  path: string,
  code: NoticeCode,
  options: { room?: string | null; redirect?: string | null } = {}
): void {
  if (typeof window === "undefined") return;
  window.location.href = withNotice(path, code, options);
}

export interface ConsumedNotice {
  code: NoticeCode;
  title: string;
  description: string;
  variant: "default" | "destructive";
}

/**
 * Reads a notice off the current URL and removes it, so it shows exactly once.
 *
 * The strip is a history.replaceState (not a navigation), so it costs nothing
 * and leaves the rest of the query string -- notably ?room= and ?redirect= --
 * untouched for whatever else on the page needs them.
 */
export function consumeNotice(): ConsumedNotice | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const code = url.searchParams.get(NOTICE_PARAM);
  if (!isNoticeCode(code)) return null;

  const room = url.searchParams.get(ROOM_PARAM);
  const notice = NOTICES[code];

  url.searchParams.delete(NOTICE_PARAM);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

  return {
    code,
    title: notice.title,
    description: notice.describe(room),
    variant: notice.variant ?? "default",
  };
}

/** Reads a validated `?redirect=` off the current URL, if there is one. */
export function readRedirectParam(): string | null {
  if (typeof window === "undefined") return null;
  return safeRedirectPath(new URLSearchParams(window.location.search).get(REDIRECT_PARAM));
}

/** The path (with query) the current page should come back to after auth. */
export function currentPathForRedirect(): string {
  if (typeof window === "undefined") return "/rooms";
  return `${window.location.pathname}${window.location.search}`;
}
