import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/features/coupons/components/FormBits";
import { fieldErrors } from "@/features/coupons/money";
import {
  KIND_LABELS,
  OWNERSHIP_LABELS,
  useCreateSchool,
  useUpdateSchool,
  useUploadSchoolLogo,
  type SchoolInput,
  type SchoolKind,
  type SchoolOwnership,
  type SchoolRow,
} from "@/features/students/api";
import { SchoolLogo } from "@/features/students/components/SchoolLogo";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";

/** Same rule as the API: `live.unilag.edu.ng`, no `@`, at least one dot. */
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const MAX_DOMAINS = 5;

/** Create (no `school`) or edit a school. */
export function SchoolDialog({
  open,
  school,
  onOpenChange,
}: {
  open: boolean;
  school: SchoolRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open && (
          <SchoolForm
            key={school?.id ?? "new"}
            school={school}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SchoolForm({
  school,
  onDone,
}: {
  school: SchoolRow | null;
  onDone: () => void;
}) {
  const create = useCreateSchool();
  const update = useUpdateSchool();
  const mutation = school ? update : create;

  const [name, setName] = useState(school?.name ?? "");
  const [shortName, setShortName] = useState(school?.shortName ?? "");
  const [kind, setKind] = useState<SchoolKind>(school?.kind ?? "university");
  const [state, setState] = useState(school?.state ?? "");
  const [ownership, setOwnership] = useState<SchoolOwnership | "">(
    school?.ownership ?? ""
  );
  const [website, setWebsite] = useState(school?.website ?? "");
  const upload = useUploadSchoolLogo();
  const [logoUrl, setLogoUrl] = useState(school?.logoUrl ?? null);
  const [domains, setDomains] = useState<string[]>(school?.emailDomains ?? []);
  const [domainInput, setDomainInput] = useState("");
  const [active, setActive] = useState(school?.active ?? false);
  const [local, setLocal] = useState<Record<string, string>>({});

  const errors = { ...fieldErrors(mutation.error), ...local };
  // The API reports array items as `emailDomains.0`; show any of them under the field.
  const domainError =
    local.emailDomains ??
    Object.entries(errors).find(([k]) => k.startsWith("emailDomains"))?.[1];

  /**
   * The list with what's typed folded in (commas or spaces split several), or an error.
   * Shared by "Add" and submit, so a domain typed but not added isn't silently dropped.
   */
  const withTyped = (): { list: string[] } | { error: string } => {
    const typed = domainInput
      .split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const bad = typed.find((d) => !DOMAIN.test(d));
    if (bad)
      return { error: `"${bad}" isn't a domain. Enter one like live.unilag.edu.ng` };
    const list = [...new Set([...domains, ...typed])];
    if (list.length > MAX_DOMAINS) return { error: `At most ${MAX_DOMAINS} domains` };
    return { list };
  };

  const addDomains = () => {
    const result = withTyped();
    if ("error" in result) {
      setLocal((p) => ({ ...p, emailDomains: result.error }));
      return;
    }
    setDomains(result.list);
    setDomainInput("");
    setLocal((p) => {
      const rest = { ...p };
      delete rest.emailDomains;
      return rest;
    });
  };

  const submit = () => {
    const problems: Record<string, string> = {};
    if (name.trim().length < 3) problems.name = "Enter the school's full name";
    if (shortName.trim().length < 2)
      problems.shortName = "Enter what students call it, e.g. UNILAG";
    if (state.trim().length < 2) problems.state = "Enter the state";
    if (website.trim() && !/^https?:\/\/\S+\.\S+/.test(website.trim()))
      problems.website = "Enter the full address, e.g. https://unilag.edu.ng";
    const result = withTyped();
    if ("error" in result) problems.emailDomains = result.error;
    setLocal(problems);
    if (Object.keys(problems).length || "error" in result) return;

    const body: SchoolInput = {
      name: name.trim(),
      shortName: shortName.trim(),
      kind,
      ...(ownership && { ownership }),
      state: state.trim(),
      ...(website.trim() && { website: website.trim() }),
      emailDomains: result.list,
      active,
    };
    const done = (saved: { shortName: string }) => {
      toast.success(school ? `${saved.shortName} saved` : `${saved.shortName} added`);
      onDone();
    };
    if (school) update.mutate({ id: school.id, ...body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">
          {school ? `Edit ${school.shortName}` : "Add a school"}
        </DialogTitle>
        <DialogDescription>
          Only active schools are offered to students in the app.
        </DialogDescription>
      </DialogHeader>

      {school && (
        <div className="flex items-center gap-3">
          <SchoolLogo
            school={{ shortName: school.shortName, logoUrl }}
            className="size-14"
          />
          <label className="cursor-pointer text-sm font-medium text-primary hover:underline">
            {upload.isPending ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                upload.mutate(
                  { id: school.id, file },
                  {
                    onSuccess: (saved) => {
                      setLogoUrl(saved.logoUrl);
                      toast.success("Logo updated");
                    },
                    onError: () => toast.error("Use a JPEG, PNG or WebP image under 5MB"),
                  }
                );
              }}
            />
          </label>
        </div>
      )}

      <FormField id="sc-name" label="Name" error={errors.name}>
        <Input
          id="sc-name"
          maxLength={120}
          value={name}
          error={!!errors.name}
          placeholder="University of Lagos"
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="sc-short" label="Short name" error={errors.shortName}>
          <Input
            id="sc-short"
            maxLength={20}
            value={shortName}
            error={!!errors.shortName}
            placeholder="UNILAG"
            onChange={(e) => setShortName(e.target.value)}
          />
        </FormField>
        <FormField label="Kind" error={errors.kind}>
          <Select value={kind} onValueChange={(v) => setKind(v as SchoolKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABELS) as SchoolKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="sc-state" label="State" error={errors.state}>
          <Input
            id="sc-state"
            maxLength={40}
            value={state}
            error={!!errors.state}
            placeholder="Lagos"
            onChange={(e) => setState(e.target.value)}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Ownership" error={errors.ownership}>
          <Select
            value={ownership}
            onValueChange={(v) => setOwnership(v as SchoolOwnership)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(OWNERSHIP_LABELS) as SchoolOwnership[]).map((o) => (
                <SelectItem key={o} value={o}>
                  {OWNERSHIP_LABELS[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <div className="sm:col-span-2">
          <FormField id="sc-web" label="Website" error={errors.website}>
            <Input
              id="sc-web"
              maxLength={200}
              value={website}
              error={!!errors.website}
              placeholder="https://unilag.edu.ng"
              onChange={(e) => setWebsite(e.target.value)}
            />
          </FormField>
        </div>
      </div>

      <FormField
        id="sc-domain"
        label="Student email domains"
        error={domainError}
        hint="Students can verify with a code to an address on these domains. Leave empty for ID card only."
      >
        <div className="flex gap-2">
          <Input
            id="sc-domain"
            value={domainInput}
            error={!!domainError}
            placeholder="live.unilag.edu.ng"
            disabled={domains.length >= MAX_DOMAINS}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addDomains();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addDomains}
            disabled={!domainInput.trim()}
          >
            Add
          </Button>
        </div>
        {domains.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1">
            {domains.map((d) => (
              <li
                key={d}
                className="text-grey-700 inline-flex items-center gap-1 rounded-full bg-grey-25 py-1 pr-1 pl-3 font-mono text-xs"
              >
                {d}
                <button
                  type="button"
                  className="hover:text-grey-700 rounded-full p-0.5 text-grey-400 hover:bg-grey-50"
                  aria-label={`Remove ${d}`}
                  onClick={() => setDomains((all) => all.filter((x) => x !== d))}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </FormField>

      <label className="flex items-center justify-between gap-4 rounded-lg border border-grey-50 px-3 py-2.5">
        <span>
          <span className="block text-sm text-grey-800">Active</span>
          <span className="block text-xs text-grey-400">
            Offered to students in the app. Off keeps it listed here only.
          </span>
        </span>
        <Switch checked={active} onCheckedChange={setActive} />
      </label>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : school ? "Save changes" : "Add school"}
        </Button>
      </DialogFooter>
    </form>
  );
}
