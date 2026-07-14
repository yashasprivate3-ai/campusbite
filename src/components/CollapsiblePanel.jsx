import { useState } from 'react'

export function CollapsiblePanel({ children, id, summary, title }) {
  const [isOpen, setIsOpen] = useState(false)
  const contentId = `${id}-content`
  const titleId = `${id}-title`

  return (
    <section
      className={`collapsible-panel${isOpen ? ' is-open' : ''}`}
      aria-labelledby={titleId}
    >
      <div className="collapsible-panel-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {summary && <span>{summary}</span>}
        </div>
        <button
          className="collapsible-panel-toggle"
          type="button"
          aria-controls={contentId}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? '▲ Collapse' : '▼ Expand'}
        </button>
      </div>

      <div
        className="collapsible-panel-content"
        id={contentId}
        role="region"
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div className="collapsible-panel-content-inner">{children}</div>
      </div>
    </section>
  )
}
