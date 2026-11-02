import "@testing-library/jest-dom";

// jsdom does not implement scrolling. The dish detail panel scrolls itself into
// view, so without this stub that effect throws and the panel boundary replaces
// the whole RTA view with an error notice.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
