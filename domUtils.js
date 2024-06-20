class Rect {
  // Create a rect given the top left and bottom right corners.
  static create(x1, y1, x2, y2) {
    return {
      bottom: y2,
      top: y1,
      left: x1,
      right: x2,
      width: x2 - x1,
      height: y2 - y1,
    };
  }

  static copy(rect) {
    return {
      bottom: rect.bottom,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    };
  }

  // Translate a rect by x horizontally and y vertically.
  static translate(rect, x, y) {
    if (x == null) x = 0;
    if (y == null) y = 0;
    return {
      bottom: rect.bottom + y,
      top: rect.top + y,
      left: rect.left + x,
      right: rect.right + x,
      width: rect.width,
      height: rect.height,
    };
  }

  // Determine whether two rects overlap.
  static intersects(rect1, rect2) {
    return (
      rect1.right > rect2.left &&
      rect1.left < rect2.right &&
      rect1.bottom > rect2.top &&
      rect1.top < rect2.bottom
    );
  }

  static equals(rect1, rect2) {
    for (const property of [
      "top",
      "bottom",
      "left",
      "right",
      "width",
      "height",
    ]) {
      if (rect1[property] !== rect2[property]) return false;
    }
    return true;
  }
}

class DomUtils {
  //
  // Bounds the rect by the current viewport dimensions. If the rect is offscreen or has a height or
  // width < 3 then null is returned instead of a rect.
  //
  static cropRectToVisible(rect) {
    const boundedRect = Rect.create(
      Math.max(rect.left, 0),
      Math.max(rect.top, 0),
      rect.right,
      rect.bottom,
    );
    if (
      boundedRect.top >= window.innerHeight - 4 ||
      boundedRect.left >= window.innerWidth - 4
    ) {
      return null;
    } else {
      return boundedRect;
    }
  }

  static getVisibleClientRect(element, testChildren) {
    // Note: this call will be expensive if we modify the DOM in between calls.
    let clientRect;
    if (testChildren == null) testChildren = false;
    const clientRects = (() => {
      const result = [];
      for (clientRect of element.getClientRects()) {
        result.push(Rect.copy(clientRect));
      }
      return result;
    })();

    // Inline elements with font-size: 0px; will declare a height of zero, even if a child with
    // non-zero font-size contains text.
    let isInlineZeroHeight = function () {
      const elementComputedStyle = window.getComputedStyle(element, null);
      const isInlineZeroFontSize =
        0 ===
          elementComputedStyle.getPropertyValue("display").indexOf("inline") &&
        elementComputedStyle.getPropertyValue("font-size") === "0px";
      // Override the function to return this value for the rest of this context.
      isInlineZeroHeight = () => isInlineZeroFontSize;
      return isInlineZeroFontSize;
    };

    for (clientRect of clientRects) {
      // If the link has zero dimensions, it may be wrapping visible but floated elements. Check for
      // this.
      let computedStyle;
      if ((clientRect.width === 0 || clientRect.height === 0) && testChildren) {
        for (const child of Array.from(element.children)) {
          computedStyle = window.getComputedStyle(child, null);
          // Ignore child elements which are not floated and not absolutely positioned for parent
          // elements with zero width/height, as long as the case described at isInlineZeroHeight
          // does not apply.
          // NOTE(mrmr1993): This ignores floated/absolutely positioned descendants nested within
          // inline children.
          const position = computedStyle.getPropertyValue("position");
          if (
            computedStyle.getPropertyValue("float") === "none" &&
            !["absolute", "fixed"].includes(position) &&
            !(
              clientRect.height === 0 &&
              isInlineZeroHeight() &&
              0 === computedStyle.getPropertyValue("display").indexOf("inline")
            )
          ) {
            continue;
          }
          const childClientRect = this.getVisibleClientRect(child, true);
          if (
            childClientRect === null ||
            childClientRect.width < 3 ||
            childClientRect.height < 3
          )
            continue;
          return childClientRect;
        }
      } else {
        clientRect = this.cropRectToVisible(clientRect);

        if (
          clientRect === null ||
          clientRect.width < 3 ||
          clientRect.height < 3
        )
          continue;

        // eliminate invisible elements (see test_harnesses/visibility_test.html)
        computedStyle = window.getComputedStyle(element, null);
        if (computedStyle.getPropertyValue("visibility") !== "visible")
          continue;

        return clientRect;
      }
    }

    return null;
  }

  static getViewportTopLeft() {
    const box = document.documentElement;
    const style = getComputedStyle(box);
    const rect = box.getBoundingClientRect();
    if (
      style.position === "static" &&
      !/content|paint|strict/.test(style.contain || "")
    ) {
      // The margin is included in the client rect, so we need to subtract it back out.
      const marginTop = parseInt(style.marginTop);
      const marginLeft = parseInt(style.marginLeft);
      return {
        top: -rect.top + marginTop,
        left: -rect.left + marginLeft,
      };
    } else {
      const { clientTop, clientLeft } = box;
      return {
        top: -rect.top - clientTop,
        left: -rect.left - clientLeft,
      };
    }
  }
}

function getElementComputedStyle(element, pseudo) {
  return element.ownerDocument && element.ownerDocument.defaultView
    ? element.ownerDocument.defaultView.getComputedStyle(element, pseudo)
    : undefined;
}

function isElementStyleVisibilityVisible(element, style) {
  style = style ?? getElementComputedStyle(element);
  if (!style) return true;
  if (
    !element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: false })
  )
    return false;
  if (style.visibility !== "visible") return false;
  return true;
}

function isElementVisible(element) {
  if (element.tagName.toLowerCase() === "option")
    return element.parentElement && isElementVisible(element.parentElement);

  const style = getElementComputedStyle(element);
  if (!style) return true;
  if (style.display === "contents") {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && isElementVisible(child)) return true;
    }
    return false;
  }
  if (!isElementStyleVisibilityVisible(element, style)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isHiddenOrDisabled(element) {
  const style = getElementComputedStyle(element);
  return style?.display === "none" || element.hidden || element.disabled;
}

function isScriptOrStyle(element) {
  const tagName = element.tagName.toLowerCase();
  return tagName === "script" || tagName === "style";
}

function hasWidgetRole(element) {
  const role = element.getAttribute("role");
  if (!role) {
    return false;
  }
  const widgetRoles = [
    "button",
    "link",
    "checkbox",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "radio",
    "tab",
    "combobox",
    "textbox",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "gridcell",
  ];
  return widgetRoles.includes(role.toLowerCase().trim());
}

function isInteractableInput(element) {
  const tagName = element.tagName.toLowerCase();
  const type = element.getAttribute("type") ?? "text";
  if (tagName !== "input") {
    return false;
  }
  const clickableTypes = [
    "button",
    "checkbox",
    "date",
    "datetime-local",
    "email",
    "file",
    "image",
    "month",
    "number",
    "password",
    "radio",
    "range",
    "reset",
    "search",
    "submit",
    "tel",
    "text",
    "time",
    "url",
    "week",
  ];
  return clickableTypes.includes(type.toLowerCase().trim());
}

function isInteractable(element) {
  if (!isElementVisible(element)) {
    return false;
  }

  if (isHiddenOrDisabled(element)) {
    return false;
  }

  if (isScriptOrStyle(element)) {
    return false;
  }

  if (hasWidgetRole(element)) {
    return true;
  }

  if (isInteractableInput(element)) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();

  if (tagName === "a" && element.href) {
    return true;
  }

  if (
    tagName === "button" ||
    tagName === "select" ||
    tagName === "option" ||
    tagName === "textarea"
  ) {
    return true;
  }

  if (tagName === "label" && element.control && !element.control.disabled) {
    return true;
  }

  if (
    element.hasAttribute("onclick") ||
    element.isContentEditable ||
    element.hasAttribute("jsaction")
  ) {
    return true;
  }

  if (tagName === "div" || tagName === "img" || tagName === "span") {
    const computedStyle = window.getComputedStyle(element);
    const hasPointer = computedStyle.cursor === "pointer";
    const hasCursor = computedStyle.cursor === "cursor";
    return hasPointer || hasCursor;
  }

  if (
    (tagName === "ul" || tagName === "div") &&
    element.hasAttribute("role") &&
    element.getAttribute("role").toLowerCase() === "listbox"
  ) {
    return true;
  }
  if (
    (tagName === "li" || tagName === "div") &&
    element.hasAttribute("role") &&
    element.getAttribute("role").toLowerCase() === "option"
  ) {
    return true;
  }

  return false;
}

const isComboboxDropdown = (element) => {
  if (element.tagName.toLowerCase() !== "input") {
    return false;
  }
  const role = element.getAttribute("role")
    ? element.getAttribute("role").toLowerCase()
    : "";
  const haspopup = element.getAttribute("aria-haspopup")
    ? element.getAttribute("aria-haspopup").toLowerCase()
    : "";
  const readonly =
    element.getAttribute("readonly") &&
    element.getAttribute("readonly").toLowerCase() !== "false";
  const controls = element.hasAttribute("aria-controls");
  return role && haspopup && controls && readonly;
};

const checkParentClass = (className) => {
  const targetParentClasses = ["field", "entry"];
  for (let i = 0; i < targetParentClasses.length; i++) {
    if (className.includes(targetParentClasses[i])) {
      return true;
    }
  }
  return false;
};

function removeMultipleSpaces(str) {
  if (!str) {
    return str;
  }
  return str.replace(/\s+/g, " ");
}

function cleanupText(text) {
  return removeMultipleSpaces(
    text.replace("SVGs not supported by this browser.", ""),
  ).trim();
}

const checkStringIncludeRequire = (str) => {
  return (
    str.toLowerCase().includes("*") ||
    str.toLowerCase().includes("✱") ||
    str.toLowerCase().includes("require")
  );
};

const checkRequiredFromStyle = (element) => {
  const afterCustom = getElementComputedStyle(element, "::after")
    .getPropertyValue("content")
    .replace(/"/g, "");
  if (checkStringIncludeRequire(afterCustom)) {
    return true;
  }

  return element.className.toLowerCase().includes("require");
};

function getElementContext(element) {
  let fullContext = new Array();

  const afterCustom = getElementComputedStyle(element, "::after")
    .getPropertyValue("content")
    .replace(/"/g, "");
  if (
    afterCustom.toLowerCase().includes("*") ||
    afterCustom.toLowerCase().includes("require")
  ) {
    fullContext.push(afterCustom);
  }
  if (element.childNodes.length === 0) {
    return fullContext.join(";");
  }
  for (var child of element.childNodes) {
    let childContext = "";
    if (child.nodeType === Node.TEXT_NODE) {
      if (!element.hasAttribute("unique_id")) {
        childContext = child.data.trim();
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (!child.hasAttribute("unique_id")) {
        childContext = getElementContext(child);
      }
    }
    if (childContext.length > 0) {
      fullContext.push(childContext);
    }
  }
  return fullContext.join(";");
}

function getElementContent(element, skipped_element = null) {
  if (skipped_element && element === skipped_element) {
    return "";
  }

  let textContent = element.textContent;
  let nodeContent = "";
  if (element.childNodes.length > 0) {
    let childTextContentList = new Array();
    let nodeTextContentList = new Array();
    for (var child of element.childNodes) {
      let childText = "";
      if (child.nodeType === Node.TEXT_NODE) {
        childText = child.data.trim();
        nodeTextContentList.push(childText);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        childText = getElementContent(child, skipped_element);
      } else {
        console.log("Unhandled node type: ", child.nodeType);
      }
      if (childText.length > 0) {
        childTextContentList.push(childText);
      }
    }
    textContent = childTextContentList.join(";");
    nodeContent = cleanupText(nodeTextContentList.join(";"));
  }
  let finalTextContent = cleanupText(textContent);
  const charLimit = 5000;
  if (finalTextContent.length > charLimit) {
    if (nodeContent.length <= charLimit) {
      finalTextContent = nodeContent;
    } else {
      finalTextContent = "";
    }
  }

  return finalTextContent;
}

function getSelectOptions(element) {
  const options = Array.from(element.options);
  const selectOptions = [];
  for (const option of options) {
    selectOptions.push({
      optionIndex: option.index,
      text: removeMultipleSpaces(option.textContent),
    });
  }
  return selectOptions;
}

function getListboxOptions(element) {
  var optionElements = element.querySelectorAll('[role="option"]');
  let selectOptions = [];
  for (var i = 0; i < optionElements.length; i++) {
    var ele = optionElements[i];
    selectOptions.push({
      optionIndex: i,
      text: removeMultipleSpaces(ele.textContent),
    });
  }
  return selectOptions;
}

function buildTreeFromBody(new_ctx = false) {
  var elements = [];
  var resultArray = [];

  const checkSelect2 = () => {
      const showInvisible = (element) => {
          if (element.style.display === "none") {
              element.style.removeProperty("display");
              return true;
          }

          const removedClass = [];
          for (let i = 0; i < element.classList.length; i++) {
              const className = element.classList[i];
              if (className.includes("hidden")) {
                  removedClass.push(className);
              }
          }
          if (removedClass.length !== 0) {
              removedClass.forEach((className) => {
                  element.classList.remove(className);
              });
              return true;
          }
          return false;
      };

      const selectContainers = document.querySelectorAll(".select2-container");

      selectContainers.forEach((element) => {
          let _pre = element.previousElementSibling;
          while (_pre) {
              if (_pre.tagName.toLowerCase() === "select" && showInvisible(_pre)) {
                  element.style.display = "none";
                  return;
              }
              _pre = _pre.previousElementSibling;
          }

          let _next = element.nextElementSibling;
          while (_next) {
              if (_next.tagName.toLowerCase() === "select" && showInvisible(_next)) {
                  element.style.display = "none";
                  return;
              }
              _next = _next.nextElementSibling;
          }
      });
  };

  function buildElementObject(element) {
      var element_id = elements.length;
      var elementTagNameLower = element.tagName.toLowerCase();
      element.setAttribute("unique_id", element_id);
      if (element.tagName.toLowerCase() === "a") {
          if (element.getAttribute("target") === "_blank") {
              element.removeAttribute("target");
          }
      }
      const attrs = {};
      for (const attr of element.attributes) {
          var attrValue = attr.value;
          if (
              attr.name === "required" ||
              attr.name === "aria-required" ||
              attr.name === "checked" ||
              attr.name === "aria-checked" ||
              attr.name === "selected" ||
              attr.name === "aria-selected" ||
              attr.name === "readonly" ||
              attr.name === "aria-readonly"
          ) {
              if (attrValue && attrValue.toLowerCase() === "false") {
                  attrValue = false;
              } else {
                  attrValue = true;
              }
          }
          attrs[attr.name] = attrValue;
      }

      if (
          new_ctx &&
          checkRequiredFromStyle(element) &&
          !attrs["required"] &&
          !attrs["aria-required"]
      ) {
          attrs["required"] = true;
      }

      if (elementTagNameLower === "input" || elementTagNameLower === "textarea") {
          attrs["value"] = element.value;
      }

      let elementObj = {
          id: element_id,
          tagName: elementTagNameLower,
          attributes: attrs,
          text: getElementContent(element),
          children: [],
          rect: DomUtils.getVisibleClientRect(element, true),
      };

      let selectOptions = null;
      if (elementTagNameLower === "select") {
          selectOptions = getSelectOptions(element);
      } else if (attrs["role"] && attrs["role"].toLowerCase() === "listbox") {
          selectOptions = getListboxOptions(element);
      } else if (isComboboxDropdown(element)) {
          element.click();
          const listBox = document.getElementById(
              element.getAttribute("aria-controls"),
          );
          if (listBox) {
              selectOptions = getListboxOptions(listBox);
          }
          element.dispatchEvent(
              new KeyboardEvent("keydown", {
                  keyCode: 9,
                  bubbles: true,
                  key: "Tab",
              }),
          );
      }
      if (selectOptions) {
          elementObj.options = selectOptions;
      }

      return elementObj;
  }

  function getChildElements(element) {
      if (element.childElementCount !== 0) {
          return Array.from(element.children);
      } else {
          return [];
      }
  }
  function processElement(element, interactableParentId) {
      if (isInteractable(element)) {
          var elementObj = buildElementObject(element);
          elements.push(elementObj);
          if (interactableParentId === null) {
              resultArray.push(elementObj);
          } else {
              elements[interactableParentId].children.push(elementObj);
          }
          if (new_ctx && elementObj.options && elementObj.options.length > 0) {
              return elementObj;
          }
          getChildElements(element).forEach((child) => {
              processElement(child, elementObj.id);
          });
          return elementObj;
      } else {
          let interactableChildren = [];
          getChildElements(element).forEach((child) => {
              let children = processElement(child, interactableParentId);
          });
      }
  }

  const getContextByParent = (element, ctx) => {
      let targetParentElements = new Set(["label", "fieldset"]);
      let targetContextualParent = null;
      let currentEle = document.querySelector(`[unique_id="${element.id}"]`);
      let parentEle = currentEle;
      for (var i = 0; i < 10; i++) {
          parentEle = parentEle.parentElement;
          if (parentEle) {
              if (
                  targetParentElements.has(parentEle.tagName.toLowerCase()) ||
                  (new_ctx && checkParentClass(parentEle.className.toLowerCase()))
              ) {
                  targetContextualParent = parentEle;
              }
          } else {
              break;
          }
      }
      if (!targetContextualParent) {
          return ctx;
      }

      let context = "";
      var lowerCaseTagName = targetContextualParent.tagName.toLowerCase();
      if (lowerCaseTagName === "fieldset") {
          targetContextualParent = targetContextualParent.parentElement;
          if (targetContextualParent) {
              context = getElementContext(targetContextualParent);
          }
      } else {
          context = getElementContext(targetContextualParent);
      }
      if (context.length > 0) {
          ctx.push(context);
      }
      return ctx;
  };

  const getContextByLinked = (element, ctx) => {
      let currentEle = document.querySelector(`[unique_id="${element.id}"]`);
      let linkedElements = new Array();
      const elementId = currentEle.getAttribute("id");
      if (elementId) {
          linkedElements = [
              ...document.querySelectorAll(`label[for="${elementId}"]`),
          ];
      }
      const labelled = currentEle.getAttribute("aria-labelledby");
      if (labelled) {
          const label = document.getElementById(labelled);
          if (label) {
              linkedElements.push(label);
          }
      }
      const described = currentEle.getAttribute("aria-describedby");
      if (described) {
          const describe = document.getElementById(described);
          if (describe) {
              linkedElements.push(describe);
          }
      }

      const fullContext = new Array();
      for (let i = 0; i < linkedElements.length; i++) {
          const linked = linkedElements[i];
          const content = getElementContent(linked, currentEle);
          if (content) {
              fullContext.push(content);
          }
      }

      const context = fullContext.join(";");
      if (context.length > 0) {
          ctx.push(context);
      }
      return ctx;
  };

  const getContextByTable = (element, ctx) => {
      let tagsWithDirectParentContext = new Set(["a"]);
      let parentTagsThatDelegateParentContext = new Set(["td", "th", "tr"]);
      if (tagsWithDirectParentContext.has(element.tagName)) {
          let parentElement = document.querySelector(
              `[unique_id="${element.id}"]`,
          ).parentElement;
          if (!parentElement) {
              return ctx;
          }
          if (
              parentTagsThatDelegateParentContext.has(
                  parentElement.tagName.toLowerCase(),
              )
          ) {
              let grandParentElement = parentElement.parentElement;
              if (grandParentElement) {
                  let context = getElementContext(grandParentElement);
                  if (context.length > 0) {
                      ctx.push(context);
                  }
              }
          }
          let context = getElementContext(parentElement);
          if (context.length > 0) {
              ctx.push(context);
          }
      }
      return ctx;
  };

  const trimDuplicatedText = (element) => {
      if (element.children.length === 0 && !element.options) {
          return;
      }

      if (element.options) {
          element.options.forEach((option) => {
              element.text = element.text.replace(option.text, "");
          });
      }

      element.children.forEach((child) => {
          element.text = element.text.replace(child.text, "");
          trimDuplicatedText(child);
      });

      element.text = element.text.replace(/;+/g, ";");
      element.text = element.text.replace(new RegExp(`^;+|;+$`, "g"), "");
  };

  const trimDuplicatedContext = (element) => {
      if (element.children.length === 0) {
          return;
      }

      element.children.forEach((child) => {
          trimDuplicatedContext(child);
          if (element.context === child.context) {
              delete child.context;
          }
          if (child.context) {
              child.context = child.context.replace(element.text, "");
              if (!child.context) {
                  delete child.context;
              }
          }
      });
  };

  const removeOrphanNode = (results) => {
      const trimmedResults = [];
      for (let i = 0; i < results.length; i++) {
          const element = results[i];
          element.children = removeOrphanNode(element.children);
          if (element.tagName === "label" && element.children.length === 0) {
              continue;
          }
          trimmedResults.push(element);
      }
      return trimmedResults;
  };

  checkSelect2();
  removeAllUniqueIdAttributes();
  processElement(document.body, null);

  for (var element of elements) {
      if (
          ((element.tagName === "input" && element.attributes["type"] === "text") ||
              element.tagName === "textarea") &&
          (element.attributes["required"] || element.attributes["aria-required"]) &&
          element.attributes.value === ""
      ) {
          console.log(
              "input element with required attribute and no value",
              element,
          );
      }

      let ctxList = [];
      ctxList = getContextByLinked(element, ctxList);
      ctxList = getContextByParent(element, ctxList);
      ctxList = getContextByTable(element, ctxList);
      const context = ctxList.join(";");
      if (context && context.length <= 5000) {
          element.context = context;
      }

      if (new_ctx && checkStringIncludeRequire(context)) {
          if (
              !element.attributes["required"] &&
              !element.attributes["aria-required"]
          ) {
              element.attributes["required"] = true;
          }
      }
  }

  if (!new_ctx) {
      console.log("Result without context:", [elements, resultArray]);
      return [elements, resultArray];
  }

  resultArray = removeOrphanNode(resultArray);
  resultArray.forEach((root) => {
      trimDuplicatedText(root);
      trimDuplicatedContext(root);
  });

  console.log("Final result array:", resultArray);
  return [elements, resultArray];
}


function drawBoundingBoxes(elements) {
  var groups = groupElementsVisually(elements);
  var hintMarkers = createHintMarkersForGroups(groups);
  addHintMarkersToPage(hintMarkers);
}

function removeAllUniqueIdAttributes() {
  var elementsWithUniqueId = document.querySelectorAll("[unique_id]");

  elementsWithUniqueId.forEach(function (element) {
    element.removeAttribute("unique_id");
  });
}

function captchaSolvedCallback() {
  console.log("captcha solved");
  if (!window["captchaSolvedCounter"]) {
    window["captchaSolvedCounter"] = 0;
  }
  window["captchaSolvedCounter"] = window["captchaSolvedCounter"] + 1;
}

function getCaptchaSolves() {
  if (!window["captchaSolvedCounter"]) {
    window["captchaSolvedCounter"] = 0;
  }
  return window["captchaSolvedCounter"];
}

function groupElementsVisually(elements) {
  const groups = [];
  for (const element of elements) {
    if (!element.rect) {
      continue;
    }
    const group = groups.find((group) => {
      for (const groupElement of group.elements) {
        if (Rect.intersects(groupElement.rect, element.rect)) {
          return true;
        }
      }
      return false;
    });
    if (group) {
      group.elements.push(element);
    } else {
      groups.push({
        elements: [element],
      });
    }
  }

  for (const group of groups) {
    group.rect = createRectangleForGroup(group);
  }

  return groups;
}

function createRectangleForGroup(group) {
  const rects = group.elements.map((element) => element.rect);
  const top = Math.min(...rects.map((rect) => rect.top));
  const left = Math.min(...rects.map((rect) => rect.left));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const right = Math.max(...rects.map((rect) => rect.right));
  return Rect.create(left, top, right, bottom);
}

function generateHintStrings(count) {
  const hintCharacters = "sadfjklewcmpgh";
  let hintStrings = [""];
  let offset = 0;

  while (hintStrings.length - offset < count || hintStrings.length === 1) {
    const hintString = hintStrings[offset++];
    for (const ch of hintCharacters) {
      hintStrings.push(ch + hintString);
    }
  }
  hintStrings = hintStrings.slice(offset, offset + count);

  return hintStrings.sort();
}

function createHintMarkersForGroups(groups) {
  if (groups.length === 0) {
    console.log("No groups found, not adding hint markers to page.");
    return [];
  }

  const hintMarkers = groups.map((group) => createHintMarkerForGroup(group));

  const hintStrings = generateHintStrings(hintMarkers.length);
  for (let i = 0; i < hintMarkers.length; i++) {
    const hintMarker = hintMarkers[i];
    hintMarker.hintString = hintStrings[i];
    hintMarker.element.innerHTML = hintMarker.hintString.toUpperCase();
  }

  return hintMarkers;
}

function createHintMarkerForGroup(group) {
  const marker = {};
  const el = document.createElement("div");
  el.style.left = group.rect.left + "px";
  el.style.top = group.rect.top + "px";
  el.style.zIndex = this.currentZIndex;

  const boundingBox = document.createElement("div");

  var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  boundingBox.style.position = "absolute";
  boundingBox.style.display = "display";
  boundingBox.style.left = group.rect.left + scrollLeft + "px";
  boundingBox.style.top = group.rect.top + scrollTop + "px";
  boundingBox.style.width = group.rect.width + "px";
  boundingBox.style.height = group.rect.height + "px";
  boundingBox.style.bottom = boundingBox.style.top + boundingBox.style.height;
  boundingBox.style.right = boundingBox.style.left + boundingBox.style.width;
  boundingBox.style.border = "2px solid blue";
  boundingBox.style.pointerEvents = "none";
  boundingBox.style.zIndex = this.currentZIndex++;

  return Object.assign(marker, {
    element: el,
    boundingBox: boundingBox,
    group: group,
  });
}

function addHintMarkersToPage(hintMarkers) {
  const parent = document.createElement("div");
  parent.id = "boundingBoxContainer";
  for (const hintMarker of hintMarkers) {
    parent.appendChild(hintMarker.boundingBox);
  }
  document.documentElement.appendChild(parent);
}

function removeBoundingBoxes() {
  var hintMarkerContainer = document.querySelector("#boundingBoxContainer");
  if (hintMarkerContainer) {
    hintMarkerContainer.remove();
  }
}

function scrollToTop(draw_boxes) {
  removeBoundingBoxes();
  window.scrollTo(0, 0);
  scrollDownAndUp();
  if (draw_boxes) {
    var elementsAndResultArray = buildTreeFromBody();
    drawBoundingBoxes(elementsAndResultArray[0]);
  }
  return window.scrollY;
}

function scrollToNextPage(draw_boxes) {
  removeBoundingBoxes();
  window.scrollBy(0, window.innerHeight - 200);
  scrollUpAndDown();
  if (draw_boxes) {
    var elementsAndResultArray = buildTreeFromBody();
    drawBoundingBoxes(elementsAndResultArray[0]);
  }
  return window.scrollY;
}

function scrollUpAndDown() {
  removeSelect2DropAbove();
  window.scrollBy(0, -1);
  removeSelect2DropAbove();
  window.scrollBy(0, 1);
}

function scrollDownAndUp() {
  removeSelect2DropAbove();
  window.scrollBy(0, 1);
  removeSelect2DropAbove();
  window.scrollBy(0, -1);
}

function removeSelect2DropAbove() {
  var select2DropAbove = document.getElementsByClassName("select2-drop-above");
  var allElements = [];
  for (var i = 0; i < select2DropAbove.length; i++) {
    allElements.push(select2DropAbove[i]);
  }
  allElements.forEach((ele) => {
    ele.classList.remove("select2-drop-above");
  });
}
