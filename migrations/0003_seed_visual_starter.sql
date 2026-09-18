-- Migration 0003: the visual starter template (kind visual, edited on the canvas).
--
-- GENERATED FILE - do not edit by hand. Regenerate with `npm run seed:generate`
-- after changing a *.email.tsx starter or starterCatalog.json; the drift test in
-- server/seedMigration.test.ts fails when this file and its sources disagree.
--
-- Starters are real, editable rows: origin 'starter', created_by 'seed', ids
-- tpl_<slug>, history starting at version 1.

-- Product launch
INSERT INTO templates (id, slug, name, description, category, status, tags, origin,
  current_version, revision, created_by, created_at, updated_by, updated_at)
VALUES ('tpl_product-launch', 'product-launch', 'Product launch',
  'Announces a release to developers on the platform. Edited on the visual canvas, not in TSX.', 'notification', 'draft',
  '["changelog","announcements"]', 'starter',
  1, 1, 'seed', '2026-09-18T10:22:00Z', 'seed', '2026-09-18T10:22:00Z');

INSERT INTO template_versions (id, template_id, version_number, kind, subject, preheader,
  reply_to, source, document, theme, html, plain_text, props_sample, props_schema, note,
  created_by, created_at)
VALUES ('tpl_product-launch_v1', 'tpl_product-launch', 1, 'visual',
  'Next-gen edge APIs and global routing', 'Lower latency routes, global failovers and updated developer tools.',
  '', NULL, '{
  "type": "doc",
  "content": [
    {
      "type": "container",
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "",
            "alignment": null,
            "class": ""
          },
          "content": [
            {
              "type": "text",
              "marks": [
                {
                  "type": "bold"
                }
              ],
              "text": "SPRING RELEASE"
            }
          ]
        },
        {
          "type": "heading",
          "attrs": {
            "style": "",
            "alignment": null,
            "class": "",
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Next-Gen Edge APIs & Global Routing"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "style": "",
            "alignment": null,
            "class": ""
          },
          "content": [
            {
              "type": "text",
              "text": "We have fully rolled out our distributed edge runtime across 38 global regions. Expect sub-15 ms cold starts, native TypeScript streaming and unified telemetry with no extra configuration."
            }
          ]
        },
        {
          "type": "twoColumns",
          "attrs": {
            "align": null,
            "width": null,
            "height": null,
            "id": null,
            "class": null,
            "title": null,
            "lang": null,
            "dir": null,
            "data-id": null,
            "cellspacing": null
          },
          "content": [
            {
              "type": "columnsColumn",
              "attrs": {
                "style": "",
                "alignment": null,
                "class": "",
                "align": null,
                "width": null,
                "height": null,
                "id": null,
                "title": null,
                "lang": null,
                "dir": null,
                "data-id": null
              },
              "content": [
                {
                  "type": "paragraph",
                  "attrs": {
                    "style": "",
                    "alignment": null,
                    "class": ""
                  },
                  "content": [
                    {
                      "type": "text",
                      "marks": [
                        {
                          "type": "bold"
                        }
                      ],
                      "text": "AVERAGE LATENCY"
                    }
                  ]
                },
                {
                  "type": "heading",
                  "attrs": {
                    "style": "",
                    "alignment": null,
                    "class": "",
                    "level": 3
                  },
                  "content": [
                    {
                      "type": "text",
                      "text": "12 ms"
                    }
                  ]
                },
                {
                  "type": "paragraph",
                  "attrs": {
                    "style": "",
                    "alignment": null,
                    "class": ""
                  },
                  "content": [
                    {
                      "type": "text",
                      "text": "Compared with origin compute."
                    }
                  ]
                }
              ]
            },
            {
              "type": "columnsColumn",
              "attrs": {
                "style": "",
                "alignment": null,
                "class": "",
                "align": null,
                "width": null,
                "height": null,
                "id": null,
                "title": null,
                "lang": null,
                "dir": null,
                "data-id": null
              },
              "content": [
                {
                  "type": "paragraph",
                  "attrs": {
                    "style": "",
                    "alignment": null,
                    "class": ""
                  },
                  "content": [
                    {
                      "type": "text",
                      "marks": [
                        {
                          "type": "bold"
                        }
                      ],
                      "text": "TARGET SLA"
                    }
                  ]
                },
                {
                  "type": "heading",
                  "attrs": {
                    "style": "",
                    "alignment": null,
                    "class": "",
                    "level": 3
                  },
                  "content": [
                    {
                      "type": "text",
                      "text": "99.99%"
                    }
                  ]
                },
                {
                  "type": "paragraph",
                  "attrs": {
                    "style": "",
                    "alignment": null,
                    "class": ""
                  },
                  "content": [
                    {
                      "type": "text",
                      "text": "Multi-region automatic failover."
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "button",
          "attrs": {
            "style": "",
            "alignment": "center",
            "class": "",
            "href": "https://meridian.example/docs"
          },
          "content": [
            {
              "type": "text",
              "text": "Explore Live Documentation →"
            }
          ]
        },
        {
          "type": "horizontalRule",
          "attrs": {
            "style": "",
            "class": ""
          }
        },
        {
          "type": "paragraph",
          "attrs": {
            "style": "",
            "alignment": null,
            "class": ""
          },
          "content": [
            {
              "type": "text",
              "text": "Meridian Systems · 548 Market Street, San Francisco, CA 94104"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "style": "",
            "alignment": null,
            "class": ""
          },
          "content": [
            {
              "type": "text",
              "text": "You are receiving this operational dispatch because you hold an active API developer credential with Meridian."
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "style": "",
            "alignment": null,
            "class": ""
          },
          "content": [
            {
              "type": "text",
              "marks": [
                {
                  "type": "link",
                  "attrs": {
                    "style": "",
                    "class": "",
                    "href": "https://meridian.example/unsubscribe",
                    "target": "_blank",
                    "rel": "noopener noreferrer nofollow",
                    "title": null,
                    "ses:no-track": null
                  }
                }
              ],
              "text": "Unsubscribe"
            },
            {
              "type": "text",
              "text": " · "
            },
            {
              "type": "text",
              "marks": [
                {
                  "type": "link",
                  "attrs": {
                    "style": "",
                    "class": "",
                    "href": "https://meridian.example/preferences",
                    "target": "_blank",
                    "rel": "noopener noreferrer nofollow",
                    "title": null,
                    "ses:no-track": null
                  }
                }
              ],
              "text": "Notification preferences"
            },
            {
              "type": "text",
              "text": " · "
            },
            {
              "type": "text",
              "marks": [
                {
                  "type": "link",
                  "attrs": {
                    "style": "",
                    "class": "",
                    "href": "https://meridian.example/privacy",
                    "target": "_blank",
                    "rel": "noopener noreferrer nofollow",
                    "title": null,
                    "ses:no-track": null
                  }
                }
              ],
              "text": "Privacy policy"
            }
          ]
        }
      ]
    }
  ]
}
',
  'studio-v1', '', '',
  '{}
', '{}
', 'Seeded starter template.',
  'seed', '2026-09-18T10:22:00Z');
