const { randomUUID } = require('crypto');

/**
 * DataModel encapsulates all domain logic for managing category hierarchies,
 * notes, and (now) AI-generated comments. The structure is persisted via a
 * storage layer but this class keeps pure data operations.
 */
class DataModel {
  constructor(initialData = null) {
    const data = initialData || DataModel.createEmptyData();
    this.categories = data.categories;
    this.notes = data.notes;
    this.aiComments = this.normalizeAiComments(data.aiComments || []);
  }

  static createEmptyData() {
    const rootId = randomUUID();
    return {
      categories: [
        {
          id: rootId,
          name: 'Home',
          description: 'Root of your Second Brain',
          parentId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      notes: [],
      aiComments: [],
    };
  }

  serialize() {
    return {
      categories: this.categories,
      notes: this.notes,
      aiComments: this.aiComments,
    };
  }

  getCategoryById(id) {
    return this.categories.find((category) => category.id === id) || null;
  }

  getNoteById(id) {
    return this.notes.find((note) => note.id === id) || null;
  }

  getAiCommentById(id) {
    return this.aiComments.find((comment) => comment.id === id) || null;
  }

  createCategory({ parentId = null, name, description = '' }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Category name is required.');
    }

    if (parentId !== null && !this.getCategoryById(parentId)) {
      throw new Error('Parent category not found.');
    }

    const newCategory = {
      id: randomUUID(),
      name: name.trim(),
      description,
      parentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.categories.push(newCategory);
    return newCategory;
  }

  renameCategory(id, newName) {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    if (!newName || typeof newName !== 'string') {
      throw new Error('New name is required.');
    }
    category.name = newName.trim();
    category.updatedAt = new Date().toISOString();
    return category;
  }

  updateCategoryDescription(id, newDescription = '') {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    category.description = newDescription;
    category.updatedAt = new Date().toISOString();
    return category;
  }

  deleteCategory(id) {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    if (category.parentId === null) {
      throw new Error('Cannot delete root category.');
    }

    const descendantIds = this.getDescendantCategoryIds(id);
    const idsToDelete = new Set([id, ...descendantIds]);

    this.categories = this.categories.filter((cat) => !idsToDelete.has(cat.id));
    this.notes = this.notes.filter((note) => !idsToDelete.has(note.categoryId));
    this.aiComments = this.aiComments.filter(
      (comment) => !idsToDelete.has(comment.categoryId)
    );
    return { deletedCategoryIds: Array.from(idsToDelete) };
  }

  moveCategory(id, newParentId) {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    if (category.parentId === null && newParentId === null) {
      return category; // already at root
    }
    if (category.parentId === null && newParentId !== null) {
      throw new Error('Cannot move root category.');
    }
    if (newParentId !== null) {
      const newParent = this.getCategoryById(newParentId);
      if (!newParent) {
        throw new Error('New parent category not found.');
      }
      const descendants = new Set(this.getDescendantCategoryIds(id));
      if (descendants.has(newParentId) || newParentId === id) {
        throw new Error('Cannot move category into one of its descendants.');
      }
    }
    category.parentId = newParentId;
    category.updatedAt = new Date().toISOString();
    return category;
  }

  getDescendantCategoryIds(categoryId) {
    const childMap = this.buildChildMap();
    const descendants = [];
    const stack = [...(childMap.get(categoryId) || [])];
    while (stack.length > 0) {
      const currentId = stack.pop();
      descendants.push(currentId);
      const children = childMap.get(currentId) || [];
      stack.push(...children);
    }
    return descendants;
  }

  buildChildMap() {
    const map = new Map();
    this.categories.forEach((category) => {
      if (!map.has(category.parentId)) {
        map.set(category.parentId, []);
      }
      map.get(category.parentId).push(category.id);
    });
    return map;
  }

  createNote({ categoryId, title = '', content = '' }) {
    const category = this.getCategoryById(categoryId);
    if (!category) {
      throw new Error('Category not found for note.');
    }
    const now = new Date().toISOString();
    const note = {
      id: randomUUID(),
      categoryId,
      title: (title || '').trim(),
      content,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.push(note);
    return note;
  }

  updateNote(id, { title, content }) {
    const note = this.getNoteById(id);
    if (!note) {
      throw new Error('Note not found.');
    }
    if (title !== undefined) {
      note.title = (title || '').trim();
    }
    if (content !== undefined) {
      note.content = content;
    }
    note.updatedAt = new Date().toISOString();
    return note;
  }

  deleteNote(id) {
    const note = this.getNoteById(id);
    if (!note) {
      throw new Error('Note not found.');
    }
    this.notes = this.notes.filter((n) => n.id !== id);
    this.aiComments = this.aiComments.filter((comment) => comment.noteId !== id);
    return { deletedNoteId: id };
  }

  getCategoryChildren(categoryId) {
    return this.categories.filter((category) => category.parentId === categoryId);
  }

  getNotesForCategory(categoryId) {
    return this.notes.filter((note) => note.categoryId === categoryId);
  }

  getAncestorCategoryIds(categoryId) {
    const ancestors = [];
    let current = this.getCategoryById(categoryId);
    while (current && current.parentId) {
      ancestors.push(current.parentId);
      current = this.getCategoryById(current.parentId);
    }
    return ancestors;
  }

  normalizeAiComments(rawComments) {
    const latestByCategory = new Map();

    rawComments.forEach((comment) => {
      const normalized = {
        ...comment,
        dismissed: comment.dismissed ?? false,
      };

      const existing = latestByCategory.get(normalized.categoryId);
      if (!existing || new Date(normalized.createdAt) > new Date(existing.createdAt)) {
        latestByCategory.set(normalized.categoryId, normalized);
      }
    });

    return Array.from(latestByCategory.values());
  }

  getAiCommentsForNote(noteId) {
    return this.aiComments.filter((comment) => comment.noteId === noteId);
  }

  getAiCommentsForCategory(categoryId) {
    return this.aiComments.filter((comment) => comment.categoryId === categoryId);
  }

  getLatestAiComments(limit = 5) {
    return [...this.aiComments]
      .filter((comment) => !comment.dismissed)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  createAiComment({ noteId, categoryId, content, model = 'mistral:7b', metadata = {} }) {
    const note = this.getNoteById(noteId);
    if (!note) {
      throw new Error('Note not found for AI comment.');
    }
    const now = new Date().toISOString();
    const targetCategoryId = categoryId || note.categoryId;

    this.aiComments = this.aiComments.filter(
      (existing) => existing.categoryId !== targetCategoryId
    );

    const comment = {
      id: randomUUID(),
      noteId,
      categoryId: targetCategoryId,
      content: content || '',
      model,
      metadata,
      dismissed: false,
      createdAt: now,
      updatedAt: now,
    };
    this.aiComments.push(comment);
    return comment;
  }

  updateAiComment(id, { content, metadata, dismissed }) {
    const comment = this.getAiCommentById(id);
    if (!comment) {
      throw new Error('AI comment not found.');
    }
    if (content !== undefined) {
      comment.content = content;
    }
    if (metadata !== undefined) {
      comment.metadata = metadata;
    }
    if (dismissed !== undefined) {
      comment.dismissed = Boolean(dismissed);
    }
    comment.updatedAt = new Date().toISOString();
    return comment;
  }

  deleteAiComment(id) {
    const existing = this.getAiCommentById(id);
    if (!existing) {
      throw new Error('AI comment not found.');
    }
    this.aiComments = this.aiComments.filter((comment) => comment.id !== id);
    return { deletedAiCommentId: id };
  }

  getBreadcrumb(categoryId) {
    const breadcrumb = [];
    let current = this.getCategoryById(categoryId);
    while (current) {
      breadcrumb.unshift(current);
      current = current.parentId ? this.getCategoryById(current.parentId) : null;
    }
    return breadcrumb;
  }

  searchCategoriesByName(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return this.categories.filter((category) =>
      category.name.toLowerCase().includes(normalized)
    );
  }

  searchByContent(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    const matches = new Map();

    this.notes.forEach((note) => {
      const haystack = `${note.title}\n${note.content}`.toLowerCase();
      if (haystack.includes(normalized)) {
        matches.set(note.categoryId, {
          category: this.getCategoryById(note.categoryId),
          notes: [],
        });
      }
    });

    this.categories.forEach((category) => {
      if (!category.description) {
        return;
      }
      if (category.description.toLowerCase().includes(normalized)) {
        if (!matches.has(category.id)) {
          matches.set(category.id, {
            category,
            notes: [],
          });
        }
      }
    });

    this.notes.forEach((note) => {
      const haystack = `${note.title}\n${note.content}`.toLowerCase();
      if (haystack.includes(normalized)) {
        const entry = matches.get(note.categoryId);
        if (entry) {
          entry.notes.push(note);
        } else {
          matches.set(note.categoryId, {
            category: this.getCategoryById(note.categoryId),
            notes: [note],
          });
        }
      }
    });

    return Array.from(matches.values());
  }
}

module.exports = {
  DataModel,
};
