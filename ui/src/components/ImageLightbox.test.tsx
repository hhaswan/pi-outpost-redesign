import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";

type UserItem = Extract<ChatItem, { kind: "user" }>;
type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

const PNG_A = { data: "AAAA", mimeType: "image/png" };
const PNG_B = { data: "BBBB", mimeType: "image/png" };

function userItem(images = [PNG_A, PNG_B]): UserItem {
  return { kind: "user", text: "look at these", entryId: "e1", images };
}

function assistantItem(text: string): AssistantItem {
  return { kind: "assistant", blocks: [{ type: "text", text }] } as AssistantItem;
}

function Conversation({ images, reply }: { images?: UserItem["images"]; reply?: string }) {
  return (
    <div>
      <UserMessage item={userItem(images)} canEdit={false} onEdit={vi.fn()} />
      {reply !== undefined && <AssistantMessage item={assistantItem(reply)} />}
    </div>
  );
}

const dialog = () => screen.queryByRole("dialog");
const counter = () => screen.getByTestId("image-lightbox-counter").textContent;
const shownSrc = () => screen.getByTestId("image-lightbox").querySelector("img")?.getAttribute("src");
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init });

describe("ImageLightbox", () => {
  it("opens the clicked attachment in a modal dialog with a counter", () => {
    render(<Conversation />);
    fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
    const view = dialog();
    expect(view).toHaveAttribute("aria-modal", "true");
    expect(view).toHaveAccessibleName(/Image viewer/);
    expect(counter()).toBe("1 / 2");
    expect(shownSrc()).toBe("data:image/png;base64,AAAA");
    expect(screen.getByRole("button", { name: "Close image viewer" })).toHaveFocus();
  });

  it("opens from the keyboard with Enter and with Space", () => {
    render(<Conversation />);
    const trigger = screen.getByRole("button", { name: "Open attached image 2" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(counter()).toBe("2 / 2");
    press("Escape");
    expect(dialog()).toBeNull();
    fireEvent.keyDown(trigger, { key: " " });
    expect(dialog()).not.toBeNull();
  });

  it("walks the conversation's images in document order with the arrow keys and buttons", () => {
    render(<Conversation reply={"Here: ![diagram](https://example.test/d.png)"} />);
    fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
    expect(counter()).toBe("1 / 3");
    press("ArrowRight");
    expect(counter()).toBe("2 / 3");
    expect(shownSrc()).toBe("data:image/png;base64,BBBB");
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(counter()).toBe("3 / 3");
    expect(shownSrc()).toBe("https://example.test/d.png");
    press("ArrowRight");
    expect(counter()).toBe("1 / 3");
    press("ArrowLeft");
    expect(counter()).toBe("3 / 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(counter()).toBe("2 / 3");
  });

  it("closes on Escape and returns focus to the image that opened it", () => {
    render(<Conversation />);
    const trigger = screen.getByRole("button", { name: "Open attached image 1" });
    trigger.focus();
    fireEvent.click(trigger);
    press("ArrowRight");
    press("Escape");
    expect(dialog()).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes from the close button and keeps the app's own Escape handlers out of it", () => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      render(<Conversation />);
      fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
      press("Escape");
      expect(outer).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Close image viewer" }));
      expect(dialog()).toBeNull();
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("closes on a click on the backdrop but not on the image", () => {
    render(<Conversation />);
    fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
    const image = screen.getByTestId("image-lightbox").querySelector("img")!;
    image.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 250, width: 200, height: 150, x: 100, y: 100, toJSON: () => ({}) });
    const stage = screen.getByTestId("image-lightbox-stage");
    fireEvent.click(stage, { clientX: 150, clientY: 150 });
    expect(dialog()).not.toBeNull();
    fireEvent.click(stage, { clientX: 10, clientY: 10 });
    expect(dialog()).toBeNull();
  });

  it("traps Tab focus inside the dialog", () => {
    render(<Conversation />);
    fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
    const buttons = [...screen.getByTestId("image-lightbox").querySelectorAll("button")];
    buttons.at(-1)!.focus();
    press("Tab");
    expect(buttons[0]).toHaveFocus();
    press("Tab", { shiftKey: true });
    expect(buttons.at(-1)).toHaveFocus();
  });

  it("locks the page scroll while open", () => {
    render(<Conversation />);
    fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
    expect(document.body.style.overflow).toBe("hidden");
    press("Escape");
    expect(document.body.style.overflow).toBe("");
  });

  it("closes instead of showing a stale image when the opened one is replaced", () => {
    const view = render(<Conversation />);
    fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
    act(() => view.rerender(<Conversation images={[{ data: "CCCC", mimeType: "image/png" }]} />));
    expect(dialog()).toBeNull();
  });

  it("hides previous/next and the counter for a single image", () => {
    render(<Conversation images={[PNG_A]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open attached image 1" }));
    expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
    expect(counter()).not.toMatch(/\//);
  });

  it("opens markdown images of a reply, inert, under their alt text", () => {
    render(<AssistantMessage item={assistantItem('![chart <b>x</b>](https://example.test/c.png "t")')} />);
    const trigger = screen.getByRole("button", { name: "Open image chart <b>x</b>" });
    expect(trigger).toHaveClass("cursor-zoom-in");
    fireEvent.click(trigger);
    expect(shownSrc()).toBe("https://example.test/c.png");
    expect(screen.getByTestId("image-lightbox").querySelector("b")).toBeNull();
  });
});
