import React, { useState } from 'react'
import './CreateListModal.css'

function CreateListModal({ isOpen, onClose, onCreate }) {
  const [listName, setListName] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (listName.trim()) {
      onCreate(listName.trim())
      setListName('')
      onClose()
    }
  }

  const handleCancel = () => {
    setListName('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Create New List</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="list-name">List Name</label>
            <input
              id="list-name"
              type="text"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="e.g., Best jrpg's of the 2010's"
              autoFocus
              required
            />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={handleCancel} className="cancel-button">
              Cancel
            </button>
            <button type="submit" className="create-button" disabled={!listName.trim()}>
              Create List
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateListModal

