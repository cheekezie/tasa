import { useEffect, useState, type ClipboardEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { fieldErrors } from "@/features/coupons/money";
import {
  FACULTY_LIMITS as LIMITS,
  useSetSchoolFaculties,
  type Faculty,
  type SchoolFaculties,
  type UnlistedDepartment,
} from "@/features/students/api";
import { count } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { Panel } from "@/shared/components/Metric";
import { useAskAction } from "@/shared/hooks/useAskAction";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

/** A faculty being edited. `input` is what's typed in its department box, not yet added. */
type Draft = {
  key: string;
  name: string;
  departments: string[];
  input: string;
  fresh?: boolean;
};

let seq = 0;
const newKey = () => `f${++seq}`;
const toDraft = (list: Faculty[]): Draft[] =>
  list.map((f) => ({
    key: newKey(),
    name: f.name,
    departments: [...f.departments],
    input: "",
  }));

const nameKey = (s: string) => s.trim().toLowerCase();

/** Same as the API's `departmentKey`: "Dept. of Computer Science " → "computer science". */
const departmentKey = (department: string) =>
  department
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the )?(department|dept)\.?( of)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Several names from one paste or entry: split on commas and new lines. */
const splitNames = (text: string) =>
  text
    .split(/[,\r\n]+/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);

const badLength = (s: string) => s.length < LIMITS.minName || s.length > LIMITS.maxName;

/** `list` with `more` added, skipping any already there (ignoring case). */
function merge(list: string[], more: string[]) {
  const seen = new Set(list.map(nameKey));
  const out = [...list];
  for (const name of more) {
    if (seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push(name);
  }
  return out;
}

/**
 * The list to send, with anything typed but not added folded in, or the problems keyed the
 * way the API keys them (`faculties.0.name`), so both show in the same place.
 */
function validate(draft: Draft[]) {
  const errors: Record<string, string> = {};
  if (draft.length > LIMITS.faculties)
    errors.faculties = `At most ${LIMITS.faculties} faculties`;
  const seen = new Set<string>();
  const list = draft.map((f, i) => {
    const name = f.name.trim().replace(/\s+/g, " ");
    if (badLength(name))
      errors[`faculties.${i}.name`] =
        `Enter the faculty's name (${LIMITS.minName}–${LIMITS.maxName} characters)`;
    else if (seen.has(nameKey(name)))
      errors[`faculties.${i}.name`] = "This faculty is listed twice";
    seen.add(nameKey(name));
    const departments = merge(f.departments, splitNames(f.input));
    const bad = departments.findIndex(badLength);
    if (bad >= 0)
      errors[`faculties.${i}.departments.${bad}`] =
        `"${departments[bad]}" must be ${LIMITS.minName}–${LIMITS.maxName} characters`;
    else if (departments.length > LIMITS.departments)
      errors[`faculties.${i}.departments`] =
        `At most ${LIMITS.departments} departments in a faculty`;
    return { name, departments };
  });
  return { list, errors };
}

const same = (a: Faculty[], b: Faculty[]) => JSON.stringify(a) === JSON.stringify(b);
const NEW_FACULTY = "\u0000new";

/** The school's faculties and departments, the editor for them, and what students typed instead. */
export function FacultiesSection({
  schoolId,
  data,
  canEdit,
}: {
  schoolId: string;
  data: SchoolFaculties;
  canEdit: boolean;
}) {
  const save = useSetSchoolFaculties(schoolId);
  const { ask } = useAskAction();
  const saved = data.faculties;
  const [draft, setDraft] = useState<Draft[] | null>(() =>
    saved.length ? toDraft(saved) : null
  );
  const [local, setLocal] = useState<Record<string, string>>({});

  const dirty =
    draft !== null &&
    (draft.some((f) => f.input.trim()) ||
      !same(
        draft.map((f) => ({ name: f.name.trim(), departments: f.departments })),
        saved
      ));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const serverErrors = fieldErrors(save.error);
  const errors = { ...serverErrors, ...local };
  const topError =
    errors.faculties ??
    errors[""] ??
    (save.error && !(save.error instanceof ApiError && save.error.errors)
      ? save.error.message
      : undefined);

  /** Every edit clears the errors: the API's are keyed by position and would point at the wrong faculty. */
  const change = (fn: (d: Draft[]) => Draft[]) => {
    setDraft((d) => fn(d ?? []));
    setLocal({});
    if (save.error) save.reset();
  };
  const edit = (key: string, patch: Partial<Draft>) =>
    change((d) => d.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  /** Adds what's typed in a faculty's box (or `text`): several at once when split by commas or lines. */
  const addTyped = (i: number, text: string) => {
    if (!draft) return;
    const f = draft[i]!;
    const names = splitNames(text);
    const bad = names.find(badLength);
    const key = `faculties.${i}.departments`;
    if (bad) {
      setLocal({
        [key]: `"${bad}" must be ${LIMITS.minName}–${LIMITS.maxName} characters`,
      });
      return;
    }
    const departments = merge(f.departments, names);
    if (departments.length > LIMITS.departments) {
      setLocal({ [key]: `At most ${LIMITS.departments} departments in a faculty` });
      return;
    }
    edit(f.key, { departments, input: "" });
  };

  const discard = () => {
    setDraft(saved.length ? toDraft(saved) : null);
    setLocal({});
    save.reset();
  };

  const submit = () => {
    if (!draft) return;
    const { list, errors: problems } = validate(draft);
    setLocal(problems);
    if (Object.keys(problems).length) return;
    save.mutate(list, {
      onSuccess: (res) => {
        setDraft(res.faculties.length ? toDraft(res.faculties) : null);
        toast.success(
          res.faculties.length
            ? "Faculties saved. Students see them now."
            : "Students at this school see the general list again."
        );
      },
    });
  };

  const revertToGeneral = () =>
    ask({
      title: "Use the general list again?",
      variant: "danger",
      confirmText: "Use the general list",
      description: (
        <p>
          This school's own list of {count(saved.length)} faculties is removed and
          students pick from Tasa’s general list. Students keep the department they
          already chose.
        </p>
      ),
      onConfirm: async () => {
        await save.mutateAsync([]);
        setDraft(null);
        setLocal({});
        return { message: "Students at this school see the general list again." };
      },
    });

  /** From "Typed by students": into the faculty named `faculty`, or a new one by that name. */
  const addUnlisted = (department: string, faculty: string, asNew: boolean) => {
    const base = draft ?? toDraft(data.general);
    const at = base.findIndex((f) => nameKey(f.name) === nameKey(faculty));
    const next =
      asNew || at < 0
        ? [
            ...base,
            { key: newKey(), name: faculty, departments: [department], input: "" },
          ]
        : base.map((f, i) =>
            i === at ? { ...f, departments: merge(f.departments, [department]) } : f
          );
    change(() => next);
    toast.success(
      `${department} added to ${faculty}${draft ? "" : ", starting from the general list"}. Save to keep it.`
    );
  };

  const listed = new Set((draft ?? []).flatMap((f) => f.departments.map(departmentKey)));
  const facultyNames = [
    ...new Map(
      (draft ?? data.general)
        .map((f) => f.name.trim())
        .filter(Boolean)
        .map((n) => [nameKey(n), n] as const)
    ).values(),
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      <Panel
        title="Faculties & departments"
        className="lg:col-span-2"
        actions={
          canEdit && draft !== null ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={discard}
                disabled={(!dirty && saved.length > 0) || save.isPending}
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={!dirty || save.isPending || (!draft.length && !saved.length)}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {draft === null ? (
          <GeneralNotice
            general={data.general}
            canEdit={canEdit}
            onStart={(list) => change(() => (list.length ? toDraft(list) : []))}
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-grey-500">
              {saved.length
                ? `Students pick from these ${count(saved.length)} faculties.`
                : "Students see Tasa’s general list until you save this one."}{" "}
              Departments students type that aren't here are listed under "Typed by
              students".
            </p>
            {topError && (
              <p role="alert" className="text-sm text-destructive">
                {topError}
              </p>
            )}
            {draft.length === 0 && (
              <p className="rounded-lg border border-dashed border-grey-100 p-4 text-center text-sm text-grey-400">
                No faculties yet. Saving an empty list means students see the general
                list.
              </p>
            )}
            <ol className="space-y-3">
              {draft.map((f, i) => {
                const nameError = errors[`faculties.${i}.name`];
                const deptError = Object.entries(errors).find(([k]) =>
                  k.startsWith(`faculties.${i}.departments`)
                )?.[1];
                return (
                  <li key={f.key} className="rounded-lg border border-grey-50 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label={`Faculty ${i + 1} name`}
                          value={f.name}
                          maxLength={LIMITS.maxName}
                          autoFocus={f.fresh}
                          disabled={!canEdit}
                          error={!!nameError}
                          placeholder="Faculty of Science"
                          onChange={(e) => edit(f.key, { name: e.target.value })}
                        />
                        {nameError && (
                          <p className="mt-1 text-xs text-destructive">{nameError}</p>
                        )}
                      </div>
                      {canEdit && (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label={`Delete ${f.name || "this faculty"}`}
                          onClick={() => change((d) => d.filter((x) => x.key !== f.key))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>

                    {f.departments.length > 0 && (
                      <ul className="flex flex-wrap gap-2 pt-3">
                        {f.departments.map((d) => (
                          <li
                            key={d}
                            className="text-grey-700 inline-flex items-center gap-1 rounded-full bg-grey-25 py-1 pr-1 pl-3 text-xs"
                          >
                            {d}
                            {canEdit && (
                              <button
                                type="button"
                                className="hover:text-grey-700 rounded-full p-0.5 text-grey-400 hover:bg-grey-50"
                                aria-label={`Remove ${d}`}
                                onClick={() =>
                                  edit(f.key, {
                                    departments: f.departments.filter((x) => x !== d),
                                  })
                                }
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canEdit && (
                      <div className="pt-3">
                        <Input
                          aria-label={`Add departments to ${f.name || "this faculty"}`}
                          value={f.input}
                          error={!!deptError}
                          placeholder="Add a department: Enter or comma adds, paste several lines"
                          onChange={(e) => edit(f.key, { input: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addTyped(i, f.input);
                            }
                          }}
                          onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
                            const text = e.clipboardData.getData("text");
                            if (!/[,\r\n]/.test(text)) return;
                            e.preventDefault();
                            addTyped(i, `${f.input},${text}`);
                          }}
                        />
                      </div>
                    )}
                    <p
                      className={`mt-1 text-xs ${deptError ? "text-destructive" : "text-grey-400"}`}
                    >
                      {deptError ??
                        `${count(f.departments.length)} of ${LIMITS.departments} departments`}
                    </p>
                  </li>
                );
              })}
            </ol>

            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-grey-50 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.length >= LIMITS.faculties}
                  onClick={() =>
                    change((d) => [
                      ...d.map((f) => ({ ...f, fresh: false })),
                      {
                        key: newKey(),
                        name: "",
                        departments: [],
                        input: "",
                        fresh: true,
                      },
                    ])
                  }
                >
                  <Plus className="size-4" /> Add faculty
                </Button>
                <span className="text-xs text-grey-400">
                  {count(draft.length)} of {LIMITS.faculties} faculties
                </span>
              </div>
            )}

            {canEdit && saved.length > 0 && (
              <div className="border-t border-grey-50 pt-4">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 text-destructive"
                  disabled={save.isPending}
                  onClick={revertToGeneral}
                >
                  Use the general list again
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Typed by students">
        <Unlisted
          rows={data.unlisted}
          listed={listed}
          facultyNames={facultyNames}
          canEdit={canEdit}
          onAdd={addUnlisted}
        />
      </Panel>
    </div>
  );
}

function GeneralNotice({
  general,
  canEdit,
  onStart,
}: {
  general: Faculty[];
  canEdit: boolean;
  onStart: (list: Faculty[]) => void;
}) {
  const departments = general.reduce((n, f) => n + f.departments.length, 0);
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-grey-25 p-4">
        <p className="text-sm font-medium text-grey-800">
          Students at this school see Tasa’s general list
        </p>
        <p className="mt-1 text-sm text-grey-500">
          {count(general.length)} faculties and {count(departments)} departments, shared
          by every school without a list of its own.
        </p>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onStart(general)}>Start from the general list</Button>
          <Button variant="outline" onClick={() => onStart([])}>
            Start empty
          </Button>
        </div>
      ) : (
        <p className="text-xs text-grey-400">
          Only compliance and support can change it.
        </p>
      )}
    </div>
  );
}

function Unlisted({
  rows,
  listed,
  facultyNames,
  canEdit,
  onAdd,
}: {
  rows: UnlistedDepartment[];
  listed: Set<string>;
  facultyNames: string[];
  canEdit: boolean;
  onAdd: (department: string, faculty: string, asNew: boolean) => void;
}) {
  if (!rows.length)
    return (
      <p className="text-sm text-grey-500">
        Every department students chose is on the list.
      </p>
    );
  return (
    <div className="space-y-3">
      <p className="text-xs text-grey-400">
        Departments students typed because they weren't on the list, most students first.
      </p>
      <ul className="divide-y divide-grey-50">
        {rows.map((r) => (
          <UnlistedRow
            key={`${r.department}-${r.faculty ?? ""}`}
            row={r}
            added={listed.has(departmentKey(r.department))}
            facultyNames={facultyNames}
            canEdit={canEdit}
            onAdd={onAdd}
          />
        ))}
      </ul>
    </div>
  );
}

function UnlistedRow({
  row,
  added,
  facultyNames,
  canEdit,
  onAdd,
}: {
  row: UnlistedDepartment;
  added: boolean;
  facultyNames: string[];
  canEdit: boolean;
  onAdd: (department: string, faculty: string, asNew: boolean) => void;
}) {
  const typed = row.faculty?.trim() ?? "";
  const match = facultyNames.find((n) => nameKey(n) === nameKey(typed));
  const offerNew = !!typed && !match && typed.length >= LIMITS.minName;
  const [picked, setPicked] = useState<string | null>(null);
  const value =
    picked !== null && (picked === NEW_FACULTY || facultyNames.includes(picked))
      ? picked
      : (match ?? "");

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium break-words text-grey-800">
            {row.department}
          </p>
          <p className="text-xs text-grey-400">
            {typed ? `Typed under ${typed}` : "No faculty typed"}
          </p>
        </div>
        <span className="shrink-0 text-xs text-grey-500 tabular-nums">
          {count(row.students)} {row.students === 1 ? "student" : "students"}
        </span>
      </div>
      {added ? (
        <p className="text-xs text-success-500">On the list. Save to keep it.</p>
      ) : (
        canEdit && (
          <div className="flex gap-2">
            <Select value={value} onValueChange={setPicked}>
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder="Choose a faculty" />
              </SelectTrigger>
              <SelectContent>
                {offerNew && (
                  <SelectItem value={NEW_FACULTY}>New faculty: {typed}</SelectItem>
                )}
                {facultyNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!value}
              onClick={() =>
                value === NEW_FACULTY
                  ? onAdd(row.department, typed, true)
                  : onAdd(row.department, value, false)
              }
            >
              Add
            </Button>
          </div>
        )
      )}
    </li>
  );
}
