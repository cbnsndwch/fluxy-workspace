// oxlint-disable no-console
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { Edit2, Trash2 } from "lucide-react";
import { memo, useState } from "react";

import { type AppIdea, STAGE_META, STAGE_STAMPS, tagColor } from "./types";

interface IdeaNodeData extends AppIdea {
  onEdit: (idea: AppIdea) => void;
  onDelete: (id: number) => void;
  isFiltered: boolean;
  rotation: number;
  paperColor: string;
  paperBorder: string;
  stackColor: string;
}

export const IdeaCardNode = memo(function IdeaCardNode({ data }: NodeProps) {
  const d = data as unknown as IdeaNodeData;
  const [hovered, setHovered] = useState(false);
  const meta = STAGE_META[d.stage];
  const stamp = STAGE_STAMPS[d.stage] ?? STAGE_STAMPS.idea;

  const rot = d.rotation ?? 0;
  const paper = d.paperColor ?? "#fef9ec";
  const border = d.paperBorder ?? "#d4c07a";
  const stackBg = d.stackColor ?? "#f5ecd0";

  // Pile layers: two sheets peeking behind, each with slight counter-rotation
  const pile1Rot = rot - 2.5;
  const pile2Rot = rot + 1.8;

  return (
    <div
      style={{
        opacity: d.isFiltered ? 0.07 : 1,
        pointerEvents: d.isFiltered ? "none" : "all",
        transition: "opacity 0.25s",
        position: "relative",
        width: 210,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Pile layer 2 (bottom) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: stackBg,
          border: `1.5px solid ${border}`,
          borderRadius: 6,
          transform: `rotate(${pile2Rot}deg)`,
          zIndex: 0,
          opacity: 0.55,
          boxShadow: "2px 3px 8px rgba(0,0,0,0.12)",
        }}
      />
      {/* Pile layer 1 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: stackBg,
          border: `1.5px solid ${border}`,
          borderRadius: 6,
          transform: `rotate(${pile1Rot}deg)`,
          zIndex: 1,
          opacity: 0.75,
          boxShadow: "2px 3px 8px rgba(0,0,0,0.12)",
        }}
      />

      {/* Main card */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          background: paper,
          border: `1.5px solid ${border}`,
          borderRadius: 6,
          transform: `rotate(${rot}deg) ${hovered ? "translateY(-4px) scale(1.03)" : ""}`,
          transition: "transform 0.18s ease, box-shadow 0.18s ease",
          boxShadow: hovered
            ? "0 12px 32px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)"
            : "3px 5px 14px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.08)",
          padding: "14px 14px 12px",
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          cursor: "grab",
        }}
      >
        {/* Pushpin dot */}
        <div
          style={{
            position: "absolute",
            top: -7,
            left: "50%",
            transform: "translateX(-50%)",
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: meta.dot,
            border: "2px solid rgba(0,0,0,0.18)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            zIndex: 10,
          }}
        />

        {/* Action buttons */}
        {hovered && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              display: "flex",
              gap: 2,
            }}
          >
            <button
              style={{
                padding: "3px",
                borderRadius: 4,
                background: "rgba(0,0,0,0.07)",
                border: "none",
                cursor: "pointer",
                color: "#555",
                display: "flex",
                alignItems: "center",
              }}
              onClick={(e) => {
                e.stopPropagation();
                d.onEdit(d as unknown as AppIdea);
              }}
            >
              <Edit2 size={11} />
            </button>
            <button
              style={{
                padding: "3px",
                borderRadius: 4,
                background: "rgba(200,0,0,0.08)",
                border: "none",
                cursor: "pointer",
                color: "#c00",
                display: "flex",
                alignItems: "center",
              }}
              onClick={(e) => {
                e.stopPropagation();
                d.onDelete(d.id);
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}

        {/* Title */}
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            color: d.stage === "dismissed" ? "#a1a1aa" : "#1a1a1a",
            lineHeight: 1.3,
            marginBottom: 6,
            marginTop: 4,
            paddingRight: 28,
            textDecoration: d.stage === "dismissed" ? "line-through" : "none",
          }}
        >
          {d.name}
        </div>

        {/* Divider line — postcard feel */}
        <div
          style={{
            height: 1,
            background: `${border}99`,
            marginBottom: 8,
          }}
        />

        {/* Description */}
        {d.description && (
          <div
            style={{
              fontSize: 11.5,
              color: "#555",
              lineHeight: 1.5,
              marginBottom: 10,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {d.description}
          </div>
        )}

        {/* Footer: stage stamp + tags */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {/* Stage stamp */}
          <span
            style={{
              display: "inline-block",
              background: stamp.bg,
              color: stamp.text,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "2px 7px",
              borderRadius: 3,
              border: `1px solid ${stamp.text}33`,
              fontFamily: "monospace",
            }}
          >
            {stamp.label}
          </span>

          {/* Tags (exclude group name to avoid duplication) */}
          {d.tags && (d.tags as string[]).filter((t) => t !== d.group_name).length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 3,
              }}
            >
              {(d.tags as string[])
                .filter((t) => t !== d.group_name)
                .slice(0, 3)
                .map((tag) => {
                  const c = tagColor(tag);
                  return (
                    <span
                      key={tag}
                      style={{
                        fontSize: 9.5,
                        background: `${c}22`,
                        color: c,
                        border: `1px solid ${c}44`,
                        borderRadius: 3,
                        padding: "1px 5px",
                      }}
                    >
                      {tag}
                    </span>
                  );
                })}
            </div>
          )}
        </div>

        {/* Group label at bottom */}
        {d.group_name && (
          <div
            style={{
              marginTop: 8,
              fontSize: 9.5,
              color: "#aaa",
              textAlign: "right",
              fontStyle: "italic",
            }}
          >
            {d.group_name}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 9,
          height: 9,
          background: meta.dot,
          border: "2px solid #fff",
          borderRadius: "50%",
          zIndex: 20,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 9,
          height: 9,
          background: meta.dot,
          border: "2px solid #fff",
          borderRadius: "50%",
          zIndex: 20,
        }}
      />
    </div>
  );
});
