import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  KIND_LABELS,
  METHOD_LABELS,
  PROGRAMME_LABELS,
  useReviewStudent,
  useRevokeStudent,
  useStudent,
  useStudentCard,
  type StudentDecision,
  type StudentDetail,
} from "@/features/students/api";
import { StudentStatusBadge } from "@/features/students/components/badges";
import { UserStatusBadge } from "@/features/users/components/badges";
import { date, dateTime } from "@/lib/format";
import { ApiError } from "@/lib/http";
import appRoutes, { toPath } from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailPageSkeleton } from "@/shared/components/DetailPageSkeleton";
import { DetailRow } from "@/shared/components/DetailSectionCard";
import { LoadFailed, Panel } from "@/shared/components/Metric";
import { ProtectedImage } from "@/shared/components/ProtectedImage";
import { UserAvatar } from "@/shared/components/UserAvatar";
import { useAskAction } from "@/shared/hooks/useAskAction";
import { Button } from "@/shared/ui/button";
import { useCan } from "@/stores";

const MIN_REASON = 5;

const studentName = (s: StudentDetail) =>
  s.user?.name ?? (s.user?.username ? `@${s.user.username}` : "This student");
const Rows = ({ children }: { children: ReactNode }) => (
  <div className="space-y-2.5 text-sm">{children}</div>
);

/** One student: who they say they are at school, their account, and (for compliance) the ID card decision. */
export default function StudentDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useStudent(id);
  const student = query.data;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <BackButton onClick={() => navigate(appRoutes.STUDENTS)} />
        {student?.user && (
          <UserAvatar
            url={student.user.avatarUrl}
            name={student.user.name ?? student.user.username ?? "?"}
            size="lg"
          />
        )}
        <div className="min-w-0">
          <h1 className="text-page-title truncate text-grey-800">
            {student ? studentName(student) : "Student"}
          </h1>
          {student && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StudentStatusBadge
                status={student.verification.status}
                revoked={student.verification.revoked}
              />
              <span className="text-sm text-grey-400">
                {student.school?.shortName ?? "Unknown school"} · {student.department} ·{" "}
                {student.levelLabel}
              </span>
            </div>
          )}
        </div>
      </div>

      {query.isError && (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      )}
      {query.isPending && <DetailPageSkeleton sectionCount={4} documentCount={0} />}
      {student && <StudentBody student={student} onStale={() => query.refetch()} />}
    </>
  );
}

function StudentBody({
  student,
  onStale,
}: {
  student: StudentDetail;
  onStale: () => void;
}) {
  const { user } = student;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Student profile">
          <Rows>
            <DetailRow
              label="School"
              value={
                student.school
                  ? `${student.school.name} (${student.school.shortName})`
                  : "—"
              }
            />
            {student.school && (
              <DetailRow
                label="Kind"
                value={`${KIND_LABELS[student.school.kind]} · ${student.school.state}`}
              />
            )}
            <DetailRow label="Faculty" value={student.faculty ?? "—"} />
            <DetailRow label="Department" value={student.department} />
            <DetailRow label="Programme" value={PROGRAMME_LABELS[student.programme] ?? student.programme} />
            <DetailRow label="Level" value={student.levelLabel} />
            <DetailRow
              label="Matric number"
              value={<span className="font-mono">{student.matricNumber}</span>}
            />
            <DetailRow label="Admission year" value={String(student.admissionYear)} />
          </Rows>
        </Panel>

        <Panel
          title="Account"
          actions={
            <Link
              to={toPath(appRoutes.USER, { id: student.id })}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open user
            </Link>
          }
        >
          {user ? (
            <Rows>
              <DetailRow label="Name" value={user.name ?? "—"} />
              <DetailRow
                label="Username"
                value={user.username ? `@${user.username}` : "—"}
              />
              <DetailRow label="Phone" value={user.phone ?? "—"} />
              <DetailRow label="Email" value={user.email ?? "—"} />
              <DetailRow
                label="Account"
                value={<UserStatusBadge status={user.status} />}
              />
              <DetailRow label="On Tasa since" value={date(user.joinedAt)} />
            </Rows>
          ) : (
            <p className="text-sm text-grey-500">
              The user account behind this profile wasn't found.
            </p>
          )}
        </Panel>
      </div>

      <Verification student={student} onStale={onStale} />
    </div>
  );
}

function Verification({
  student,
  onStale,
}: {
  student: StudentDetail;
  onStale: () => void;
}) {
  const canReview = useCan("compliance");
  const card = useStudentCard(student.id);
  const v = student.verification;

  return (
    <Panel title="Verification">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Rows>
          <DetailRow
            label="Status"
            value={<StudentStatusBadge status={v.status} revoked={v.revoked} />}
          />
          <DetailRow label="Method" value={v.method ? METHOD_LABELS[v.method] : "—"} />
          {v.email && <DetailRow label="School email" value={v.email} />}
          <DetailRow label="Sent" value={dateTime(v.submittedAt)} />
          <DetailRow label="Verified" value={dateTime(v.verifiedAt)} />
          <DetailRow label="Reviewed" value={dateTime(v.reviewedAt)} />
          <DetailRow label="Reviewed by" value={v.reviewedBy ?? "—"} />
          {v.reason && (
            <DetailRow
              label={v.revoked ? "Revoked because" : "Rejected because"}
              value={v.reason}
            />
          )}
        </Rows>

        <div className="space-y-4">
          {v.status === "unsubmitted" && (
            <p className="text-sm text-grey-500">
              They haven't verified yet.
            </p>
          )}
          {v.status === "verified" && (
            <p className="text-sm text-grey-500">
              {v.method === "email"
                ? "Verified with a code to their school email."
                : "Verified from their student ID card."}
            </p>
          )}
          {v.status === "rejected" && v.revoked && (
            <div className="rounded-xl border border-[#D03333]/20 bg-[#FEF3F2] p-3 text-sm text-[#B42318]">
              Revoked. Staff took back their verification. They need to send a student ID
              card for staff to check.
            </div>
          )}
          {v.status === "rejected" && !v.revoked && (
            <p className="text-sm text-grey-500">
              Rejected. They were sent the reason and can send a new card.
            </p>
          )}
          {v.status === "pending" && (
            <p className="text-sm text-grey-500">
              Waiting for a decision. Check the card shows this school, the name on the
              account and matric number {student.matricNumber}. They're notified either
              way, with your reason if you reject.
            </p>
          )}

          {canReview ? (
            v.hasCard ? (
              <ProtectedImage
                key={`${student.id}-${v.submittedAt ?? ""}`}
                title="Student ID card"
                showLabel="View ID card"
                file={card}
              />
            ) : (
              v.method === "id_card" && (
                <p className="text-sm text-grey-400">
                  No ID card is stored for this student.
                </p>
              )
            )
          ) : (
            v.hasCard && (
              <p className="text-xs text-grey-400">
                Only compliance can see the ID card.
              </p>
            )
          )}

          {v.status === "pending" &&
            (canReview ? (
              <div className="border-t border-grey-50 pt-4">
                <ReviewActions student={student} onStale={onStale} />
              </div>
            ) : (
              <p className="text-xs text-grey-400">
                Only compliance can approve or reject.
              </p>
            ))}

          {v.status === "verified" && canReview && (
            <div className="border-t border-grey-50 pt-4">
              <RevokeAction student={student} onStale={onStale} />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** What the API's codes mean for whoever is deciding. */
const REVIEW_ERRORS: Record<string, string> = {
  STUDENT_NOT_PENDING:
    "Someone else has already decided on this student. The page now shows where it stands.",
  MATRIC_TAKEN:
    "Another account was verified with this matric number at this school, so this one can't be. Reject it, or check with support who owns the number.",
};

function ReviewActions({
  student,
  onStale,
}: {
  student: StudentDetail;
  onStale: () => void;
}) {
  const review = useReviewStudent(student.id);
  const { ask } = useAskAction();
  const name = studentName(student);

  const decide = async (decision: StudentDecision) => {
    try {
      await review.mutateAsync(decision);
    } catch (err) {
      if (err instanceof ApiError && REVIEW_ERRORS[err.code]) {
        onStale();
        throw new Error(REVIEW_ERRORS[err.code]);
      }
      throw err;
    }
  };

  const approve = () =>
    ask({
      title: `Verify ${name}?`,
      variant: "success",
      confirmText: "Approve",
      description: (
        <div className="space-y-2">
          <p>
            Only approve if the card is for {student.school?.shortName ?? "their school"},
            shows the name on this account and matric number{" "}
            <span className="font-mono">{student.matricNumber}</span>.
          </p>
          <p>They're told straight away.</p>
        </div>
      ),
      onConfirm: async () => {
        await decide({ status: "verified" });
        return { message: `${name} is verified. They've been told.` };
      },
    });

  const reject = () =>
    ask({
      title: `Reject ${name}?`,
      variant: "danger",
      confirmText: "Reject",
      description: <p>They're notified with your reason and can send a new card.</p>,
      input: {
        label: `Reason (the student sees this, at least ${MIN_REASON} characters)`,
        placeholder: "The matric number on the card doesn't match the one you entered.",
        required: true,
        variant: "textarea",
        minLength: MIN_REASON,
        maxLength: 300,
      },
      onConfirm: async ({ inputValue = "" }) => {
        await decide({ status: "rejected", reason: inputValue });
        return { message: `${name} was rejected and has been sent your reason.` };
      },
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={approve}>
        Approve
      </Button>
      <Button size="sm" variant="destructive" onClick={reject}>
        Reject
      </Button>
    </div>
  );
}

const REVOKE_ERRORS: Record<string, string> = {
  STUDENT_NOT_VERIFIED:
    "This student isn't verified any more. The page now shows where it stands.",
};

/** Takes back a verification, however it was given (compliance, verified students only). */
function RevokeAction({
  student,
  onStale,
}: {
  student: StudentDetail;
  onStale: () => void;
}) {
  const revoke = useRevokeStudent(student.id);
  const { ask } = useAskAction();
  const name = studentName(student);

  const open = () =>
    ask({
      title: `Revoke ${name}'s verification?`,
      variant: "danger",
      confirmText: "Revoke",
      description: (
        <p>
          They'll need to send a student ID card for staff to check.
        </p>
      ),
      input: {
        label: `Reason (the student sees this, at least ${MIN_REASON} characters)`,
        placeholder: "They're no longer a student there.",
        required: true,
        variant: "textarea",
        minLength: MIN_REASON,
        maxLength: 300,
      },
      onConfirm: async ({ inputValue = "" }) => {
        try {
          await revoke.mutateAsync(inputValue);
        } catch (err) {
          if (err instanceof ApiError && REVOKE_ERRORS[err.code]) {
            onStale();
            throw new Error(REVOKE_ERRORS[err.code]);
          }
          throw err;
        }
        return { message: `${name}'s verification was revoked.` };
      },
    });

  return (
    <Button size="sm" variant="destructive" onClick={open}>
      Revoke verification
    </Button>
  );
}
