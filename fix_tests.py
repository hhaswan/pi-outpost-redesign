import re

with open("ui/src/components/ToolCard.test.tsx", "r") as f:
    content = f.read()

# Fix statusDot selection
content = content.replace('const statusDot = button?.querySelector("span");', 'const statusDot = button?.querySelectorAll("span")[1];')

# Fix command summary selection
content = content.replace('expect(cardRoot(container).querySelector("span[class*=\'text-xs\']")?.textContent).toBe("npm install");', 'expect(cardRoot(container).querySelector("span.whitespace-nowrap")?.textContent).toBe("npm install");')

# Fix edit/write test that expects expanded by clicking
content = re.sub(
    r'(render\(<ToolCard item={item} />\);\s+const splitDiffBlocks = screen\.getAllByTestId\("split-diff-block"\);)',
    r'const { container } = render(<ToolCard item={item} />);\n    fireEvent.click(cardRoot(container).querySelector("button")!);\n\n    const splitDiffBlocks = screen.getAllByTestId("split-diff-block");',
    content
)

content = re.sub(
    r'(render\(<ToolCard item={item} />\);\s+const diffBlocks = screen\.getAllByTestId\("diff-block"\);)',
    r'const { container } = render(<ToolCard item={item} />);\n    fireEvent.click(cardRoot(container).querySelector("button")!);\n\n    const diffBlocks = screen.getAllByTestId("diff-block");',
    content
)

# Fix starts expanded for edit/write tools test
content = content.replace(
    '''it("starts expanded for edit/write tools", () => {
    const editItem: ToolItem = { ...TOOL_DEFAULTS, kind: "tool", toolName: "edit" };
    const writeItem: ToolItem = { ...TOOL_DEFAULTS, kind: "tool", toolName: "write" };

    const editRoot = cardRoot(render(<ToolCard item={editItem} />).container);
    const writeRoot = cardRoot(render(<ToolCard item={writeItem} />).container);

    expect(editRoot.children.length).toBe(2);
    expect(writeRoot.children.length).toBe(2);
  });''',
    '''it("starts collapsed by default for all tools", () => {
    const editItem: ToolItem = { ...TOOL_DEFAULTS, kind: "tool", toolName: "edit" };
    const writeItem: ToolItem = { ...TOOL_DEFAULTS, kind: "tool", toolName: "write" };

    const editRoot = cardRoot(render(<ToolCard item={editItem} />).container);
    const writeRoot = cardRoot(render(<ToolCard item={writeItem} />).container);

    expect(editRoot.children.length).toBe(1);
    expect(writeRoot.children.length).toBe(1);
  });'''
)

with open("ui/src/components/ToolCard.test.tsx", "w") as f:
    f.write(content)
