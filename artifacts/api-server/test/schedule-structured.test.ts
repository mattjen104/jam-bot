import { describe, expect, it } from "vitest";
import { parseTabbedHostSchedule } from "../src/lore/schedule-structured.js";

describe("parseTabbedHostSchedule", () => {
  it("extracts first-party tabbed programme and host cells", () => {
    const html = `
      <div id="scheduleContent">
        <div class="tab-pane fade show" id="sunday">
          <div class="time-slot d-lg-flex">
            <div class="cell">6:00 am - 8:00 am MT</div>
            <div class="cell"><h3><a href="/host/joe/">Joe Hartfeil</a></h3></div>
            <div class="cell">Morningsong</div>
            <div class="cell">Classical</div>
          </div>
        </div>
      </div>`;

    expect(parseTabbedHostSchedule(html)).toEqual([
      {
        showName: "Morningsong",
        dayOfWeek: "Sun",
        startTime: "06:00",
        endTime: "08:00",
        djName: "Joe Hartfeil",
      },
    ]);
  });

  it("ignores unrelated tab markup", () => {
    expect(parseTabbedHostSchedule('<div class="tab-pane" id="sunday"></div>')).toBeNull();
  });
});